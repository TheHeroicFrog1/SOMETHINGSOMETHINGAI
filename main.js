const { app, BrowserWindow, dialog, Tray, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const net = require('net');

let mainWindow;
let backendProcess;
let tray = null;
let isQuitting = false;

const getSettingsPath = () => path.join(app.getPath('userData'), 'settings.json');

const getSettings = () => {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'));
  } catch (e) {
    return { closeBehavior: 'ask' };
  }
};

const saveSettings = (settings) => {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
};

ipcMain.handle('get-settings', () => getSettings());
ipcMain.on('save-settings', (event, settings) => saveSettings(settings));
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

function createTray() {
  if (tray) return;
  try {
    const iconPath = path.join(__dirname, 'build/icon.png');
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show Bifrost', click: () => { if (mainWindow) mainWindow.show(); } },
      { label: 'Quit', click: () => {
        isQuitting = true;
        app.quit();
      }}
    ]);
    tray.setToolTip('Bifrost');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => { if (mainWindow) mainWindow.show(); });
  } catch (err) {
    console.error('Failed to create tray icon:', err);
  }
}

function getBackendPath() {
  const isDev = !app.isPackaged;
  const platform = process.platform;
  let backendExecutable = 'bifrost-backend';
  
  if (platform === 'win32') {
    backendExecutable += '.exe';
  }

  if (isDev) {
    // In dev mode, we assume user is running `uvicorn main:app` separately, or we could spawn it.
    // For simplicity, in dev, we just launch the python script or rely on existing instance.
    return { path: null, isDev: true };
  } else {
    // In production, PyInstaller creates a dist folder, bundled inside Electron's 'resources' folder.
    return { 
      path: path.join(process.resourcesPath, 'backend-dist', backendExecutable),
      isDev: false
    };
  }
}

function startBackend() {
  return new Promise((resolve, reject) => {
    const { path: backendPath, isDev } = getBackendPath();

    let spawnCmd;
    let spawnArgs;

    if (isDev) {
      console.log('Running in development mode. Automatically spawning Python backend...');
      // Use venv Python for reliability if available
      const venvPython = path.join(__dirname, '.venv', 'Scripts', 'python.exe');
      const venvPythonUnix = path.join(__dirname, '.venv', 'bin', 'python');
      if (fs.existsSync(venvPython)) {
        spawnCmd = venvPython;
      } else if (fs.existsSync(venvPythonUnix)) {
        spawnCmd = venvPythonUnix;
      } else {
        spawnCmd = 'python';
      }
      spawnArgs = [path.join(__dirname, 'backend', 'main.py')];
    } else {
      console.log('Starting compiled backend:', backendPath);
      spawnCmd = backendPath;
      spawnArgs = [];
    }
    
    let env = { ...process.env };
    let settings = getSettings();
    if (settings.dataPath) {
      env.BIFROST_DATA_PATH = settings.dataPath;
    }

    // Attempt to start local Ollama engine automatically
    try {
      const { exec } = require('child_process');
      const ollamaEnv = { ...process.env, OLLAMA_ORIGINS: "*" };
      exec('ollama serve', { windowsHide: true, env: ollamaEnv }, (err) => {
        // If it fails, Ollama is likely already running or not installed. We can safely ignore.
      });
      console.log('Sent start signal to Ollama service (if installed).');
    } catch (e) {
      console.log('Failed to start Ollama automatically:', e);
    }

    let restartTimestamps = [];

    const launchProcess = () => {
      const now = Date.now();
      restartTimestamps = restartTimestamps.filter(ts => now - ts < 10000);
      
      if (restartTimestamps.length >= 5) {
        console.error("Backend process crashed 5 times within 10 seconds. Halting auto-restart to prevent boot loops.");
        dialog.showErrorBox('Fatal Error', 'The backend server crashed repeatedly and could not be recovered. Please check the logs.');
        return;
      }
      restartTimestamps.push(now);

      backendProcess = spawn(spawnCmd, spawnArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });

      if (backendProcess.stdout) {
        backendProcess.stdout.on('data', (data) => {
          console.log(`[Backend] ${data.toString().trim()}`);
        });
      }
      if (backendProcess.stderr) {
        backendProcess.stderr.on('data', (data) => {
          console.error(`[Backend Error] ${data.toString().trim()}`);
        });
      }

      backendProcess.on('error', (err) => {
        console.error('Failed to start backend:', err);
        dialog.showErrorBox('Backend Error', `Failed to start the backend server:\n${err.message}`);
        reject(err);
      });

      backendProcess.on('exit', (code) => {
        console.log(`Backend process exited with code ${code}`);
        if (!isQuitting) {
          console.log("Auto-restarting backend server...");
          // If backend crashes, restart it. We also try to ensure Ollama is up again
          try {
            const { exec } = require('child_process');
            const ollamaEnv = { ...process.env, OLLAMA_ORIGINS: "*" };
            exec('ollama serve', { windowsHide: true, env: ollamaEnv }, () => {});
          } catch(e) {}
          setTimeout(launchProcess, 2000); // Auto-restart after 2 seconds
        }
      });
    };

    launchProcess();

    // Wait for the backend to start accepting connections
    const checkPort = () => {
      const socket = new net.Socket();
      socket.setTimeout(1000);
      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.on('timeout', () => {
        socket.destroy();
        setTimeout(checkPort, 500);
      });
      socket.on('error', () => {
        socket.destroy();
        setTimeout(checkPort, 500);
      });
      socket.connect(8000, '127.0.0.1');
    };

    checkPort();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'build/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    autoHideMenuBar: true
  });
  
  mainWindow.maximize();

  const isDev = !app.isPackaged;
  if (isDev) {
    // Dev: React server
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // Prod: Local file
    mainWindow.loadFile(path.join(__dirname, 'frontend/dist/index.html'));
  }

  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    
    let settings = getSettings();
    let behavior = settings.closeBehavior;
    
    if (behavior === 'ask') {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        buttons: ['Run in background', 'Close completely'],
        defaultId: 0,
        cancelId: 1,
        title: 'Close Application',
        message: 'Do you want to keep Bifrost running in the background or close it completely?',
        checkboxLabel: 'Remember my choice',
        checkboxChecked: true
      });
      
      behavior = choice === 0 ? 'background' : 'quit';
      settings.closeBehavior = behavior;
      saveSettings(settings);
    }
    
    if (behavior === 'background') {
      e.preventDefault();
      mainWindow.hide();
    } else {
      isQuitting = true;
      app.quit();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    createTray();
    await startBackend();
    createWindow();
  } catch (error) {
    console.error('Initialization failed:', error);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (isQuitting && process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  if (backendProcess) {
    console.log('Killing backend process...');
    if (process.platform === 'win32') {
      try {
        spawnSync('taskkill', ['/pid', backendProcess.pid, '/f', '/t']);
      } catch (e) {
        console.error('Failed to taskkill backend:', e);
      }
    } else {
      backendProcess.kill();
    }
  }
});
