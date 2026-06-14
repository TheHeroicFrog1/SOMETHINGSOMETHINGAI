import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// Helpers for friendly @ mention aliases
const getModelFriendlyName = (model) => {
  if (!model) return 'Model';
  const provider = (model.provider || '').toLowerCase();
  const nameLower = (model.name || '').toLowerCase();
  const idLower = (model.id || '').toLowerCase();
  
  if (provider === 'gemini' || nameLower.includes('gemini') || idLower.includes('gemini')) return 'Gemini';
  if (provider === 'openai' || nameLower.includes('gpt') || idLower.includes('gpt') || nameLower.includes('openai') || idLower.includes('openai')) return 'GPT';
  if (nameLower.includes('llama') || idLower.includes('llama')) return 'Llama';
  if (nameLower.includes('claude') || idLower.includes('claude')) return 'Claude';
  if (nameLower.includes('mistral') || idLower.includes('mistral') || nameLower.includes('mixtral') || idLower.includes('mixtral')) return 'Mistral';
  if (nameLower.includes('phi') || idLower.includes('phi')) return 'Phi';
  if (nameLower.includes('deepseek') || idLower.includes('deepseek')) return 'DeepSeek';
  if (nameLower.includes('gemma') || idLower.includes('gemma')) return 'Gemma';
  
  // Fallback: capitalize provider or first part of id
  const rawWord = model.id.split(':')[0].split('/').pop().split('-')[0];
  return rawWord.charAt(0).toUpperCase() + rawWord.slice(1);
};

const getModelAlias = (model) => {
  return getModelFriendlyName(model).toLowerCase();
};

function App() {
  const [currentView, setCurrentView] = useState('chat'); 
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [activeRightTab, setActiveRightTab] = useState('context');

  const [visibleModels, setVisibleModels] = useState({});
  const [selectedParallelModels, setSelectedParallelModels] = useState([]);

  // 1. API Configuration List
  const [apiConfigs, setApiConfigs] = useState([
    { id: 'ollama_local', name: 'Ollama (Local)', provider: 'ollama', baseUrl: 'http://localhost:11434', apiKey: '', enabled: true },
    { id: 'openai_cloud', name: 'OpenAI (Cloud)', provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '', enabled: false },
    { id: 'gemini_cloud', name: 'Google Gemini (Cloud)', provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: '', enabled: false }
  ]);

  // 2. Multi-Workspace State
  const [projects, setProjects] = useState([
    { id: 'w_default', name: 'Default Workspace', filesIndexed: 0, contextLines: 0, messages: [], tokenUsage: 0 }
  ]);

  const [activeProjectId, setActiveProjectId] = useState('w_default');
  const activeProject = projects.find(p => p.id === activeProjectId) || projects[0];
  const currentMessages = activeProject ? activeProject.messages : [];
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, projectId: null });
  const [promptModal, setPromptModal] = useState({ visible: false, title: '', value: '', type: '', data: null });
  const [showBufferManager, setShowBufferManager] = useState(false);

  // 3. Dynamic Model Discovery States
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const visibleAvailableModels = availableModels.filter(m => visibleModels[m.name] !== false);

  // 4. Client Inputs & Mentions autocomplete
  const [input, setInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const activeBufferLimitMb = activeProject ? (activeProject.bufferLimitMb || 100) : 100;
  const [showMentionList, setShowMentionList] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);

  // 5. Core Tunings (Workspace Settings)
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [systemPrompt, setSystemPrompt] = useState("");

  // 5b. Multi-Agent & Personalities States
  const [respondAll, setRespondAll] = useState(false);
  const [modelPersonalities, setModelPersonalities] = useState({});

  // 5c. Backend Sync & Init State
  const [isInitialized, setIsInitialized] = useState(false);

  // 5d. Electron Client Settings
  const [electronCloseBehavior, setElectronCloseBehavior] = useState('ask');
  const [electronDataPath, setElectronDataPath] = useState('');

  useEffect(() => {
    if (window.require) {
      try {
        const { ipcRenderer } = window.require('electron');
        ipcRenderer.invoke('get-settings').then(s => {
          if (s && s.closeBehavior) setElectronCloseBehavior(s.closeBehavior);
          if (s && s.dataPath) setElectronDataPath(s.dataPath);
        });
      } catch (e) {}
    }
  }, []);

  const handleCloseBehaviorChange = (behavior) => {
    setElectronCloseBehavior(behavior);
    if (window.require) {
      try {
        const { ipcRenderer } = window.require('electron');
        ipcRenderer.invoke('get-settings').then(s => {
          ipcRenderer.send('save-settings', { ...s, closeBehavior: behavior });
        });
      } catch (e) {}
    }
  };

  const handleSelectDataPath = async () => {
    if (window.require) {
      try {
        const { ipcRenderer } = window.require('electron');
        const selectedPath = await ipcRenderer.invoke('select-directory');
        if (selectedPath) {
          setElectronDataPath(selectedPath);
          ipcRenderer.invoke('get-settings').then(s => {
            ipcRenderer.send('save-settings', { ...s, dataPath: selectedPath });
          });
          alert("Data path updated. Please restart the application for changes to take effect.");
        }
      } catch (e) {}
    }
  };

  // Helper to sync project messages & stats to DB
  const syncProjectMessages = async (projectId, messages, tokenUsage, filesIndexed, contextLines, bufferLimitMb) => {
    try {
      await fetch(`http://localhost:8000/api/chats/${projectId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages,
          tokenUsage: tokenUsage !== undefined ? tokenUsage : null,
          filesIndexed: filesIndexed !== undefined ? filesIndexed : null,
          contextLines: contextLines !== undefined ? contextLines : null,
          bufferLimitMb: bufferLimitMb !== undefined ? bufferLimitMb : null
        })
      });
    } catch (err) {
      console.error("Failed to sync project messages to backend:", err);
    }
  };

  // Initialization fetch from backend SQLite database
  useEffect(() => {
    const initApp = async () => {
      try {
        // 1. Fetch settings
        const settingsRes = await fetch('http://localhost:8000/api/settings');
        if (settingsRes.ok) {
          const settingsData = await settingsRes.json();
          if (settingsData.api_configs && settingsData.api_configs.length > 0) {
            setApiConfigs(settingsData.api_configs);
          }
          if (settingsData.general_settings) {
            const gs = settingsData.general_settings;
            if (gs.temperature !== undefined) setTemperature(gs.temperature);
            if (gs.max_tokens !== undefined) setMaxTokens(gs.max_tokens);
            if (gs.system_prompt !== undefined) setSystemPrompt(gs.system_prompt);
            if (gs.respond_all !== undefined) setRespondAll(gs.respond_all);
            if (gs.selected_model !== undefined) setSelectedModel(gs.selected_model);
            if (gs.model_personalities) {
              try {
                setModelPersonalities(JSON.parse(gs.model_personalities));
              } catch (e) {
                console.error("Failed to parse model_personalities:", e);
              }
            }
            if (gs.visible_models) {
              try {
                setVisibleModels(JSON.parse(gs.visible_models));
              } catch (e) {
                console.error("Failed to parse visible_models:", e);
              }
            }
            if (gs.selected_parallel_models) {
              try {
                setSelectedParallelModels(JSON.parse(gs.selected_parallel_models));
              } catch (e) {
                console.error("Failed to parse selected_parallel_models:", e);
              }
            }
          }
        }

        // 2. Fetch chats/workspaces
        const chatsRes = await fetch('http://localhost:8000/api/chats');
        if (chatsRes.ok) {
          const chatsData = await chatsRes.json();
          if (chatsData && chatsData.length > 0) {
            setProjects(chatsData);
            const savedActiveId = localStorage.getItem('bifrost_active_project_id') || 'w_default';
            if (chatsData.some(p => p.id === savedActiveId)) {
              setActiveProjectId(savedActiveId);
            } else {
              setActiveProjectId(chatsData[0].id);
            }
          }
        }
      } catch (err) {
        console.error("Failed to initialize app settings/chats from backend", err);
      } finally {
        setIsInitialized(true);
      }
    };
    initApp();
  }, []);

  // Save active project selection
  useEffect(() => {
    localStorage.setItem('bifrost_active_project_id', activeProjectId);
  }, [activeProjectId]);

  // Sync API configurations to backend
  useEffect(() => {
    if (!isInitialized) return;
    const syncConfigs = async () => {
      try {
        await fetch('http://localhost:8000/api/settings/configs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(apiConfigs)
        });
      } catch (err) {
        console.error("Failed to sync api configs to backend", err);
      }
    };
    syncConfigs();
  }, [apiConfigs, isInitialized]);

  // Sync General parameters to backend
  useEffect(() => {
    if (!isInitialized) return;
    const syncGeneralSettings = async () => {
      try {
        await fetch('http://localhost:8000/api/settings/general', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            temperature: String(temperature !== undefined ? temperature : 0.7),
            max_tokens: String(maxTokens !== undefined ? maxTokens : 4096),
            system_prompt: String(systemPrompt || ''),
            respond_all: String(respondAll),
            selected_model: String(selectedModel || ''),
            model_personalities: JSON.stringify(modelPersonalities),
            visible_models: JSON.stringify(visibleModels),
            selected_parallel_models: JSON.stringify(selectedParallelModels)
          })
        });
      } catch (err) {
        console.error("Failed to sync general settings to backend:", err);
      }
    };
    syncGeneralSettings();
  }, [temperature, maxTokens, systemPrompt, respondAll, selectedModel, modelPersonalities, visibleModels, selectedParallelModels, isInitialized]);

  const [personalityTargetModel, setPersonalityTargetModel] = useState('');

  useEffect(() => {
    if (visibleAvailableModels.length > 0 && (!personalityTargetModel || !visibleAvailableModels.some(m => m.id === personalityTargetModel))) {
      setPersonalityTargetModel(visibleAvailableModels[0].id);
    }
  }, [visibleAvailableModels, personalityTargetModel]);
  
  // 5c. Local Model Setup States and Handlers
  const [isScanning, setIsScanning] = useState(false);
  const [detectedEngines, setDetectedEngines] = useState([
    { name: 'Ollama', status: 'Not Checked', models: [], url: 'http://127.0.0.1:11434' },
    { name: 'LM Studio', status: 'Not Checked', models: [], url: 'http://127.0.0.1:1234' },
    { name: 'GPT4All', status: 'Not Checked', models: [], url: 'http://127.0.0.1:4891' }
  ]);
  const [ggufFilePath, setGgufFilePath] = useState('');
  const [ggufModelName, setGgufModelName] = useState('');
  const [ggufSystemPrompt, setGgufSystemPrompt] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  const handleAutoDetect = async () => {
    setIsScanning(true);
    try {
      const res = await fetch('http://localhost:8000/api/models/autodetect');
      if (res.ok) {
        const data = await res.json();
        setDetectedEngines(data.engines);
        await syncModels();
      }
    } catch (e) {
      console.error("[ERROR] Failed autodetecting local models:", e);
    } finally {
      setIsScanning(false);
    }
  };

  const handleImportGguf = async (e) => {
    if (e) e.preventDefault();
    if (!ggufFilePath.trim() || !ggufModelName.trim()) {
      alert("Please provide both the GGUF file path and a custom model name.");
      return;
    }

    setIsImporting(true);
    try {
      const res = await fetch('http://localhost:8000/api/models/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_path: ggufFilePath.trim(),
          model_name: ggufModelName.trim(),
          system_prompt: ggufSystemPrompt.trim() || undefined
        })
      });

      const data = await res.json();
      if (res.ok) {
        alert(data.message || "Model imported successfully!");
        setGgufFilePath('');
        setGgufModelName('');
        setGgufSystemPrompt('');
        await syncModels();
        // Update status lists as well
        const fresh = await fetch('http://localhost:8000/api/models/autodetect');
        if (fresh.ok) {
          const freshData = await fresh.json();
          setDetectedEngines(freshData.engines);
        }
      } else {
        alert(`Import Failed: ${data.detail || 'Unknown error'}`);
      }
    } catch (err) {
      console.error(err);
      alert("Error contacting import service.");
    } finally {
      setIsImporting(false);
    }
  };

  useEffect(() => {
    handleAutoDetect();
  }, []);
  
  // Refs
  const fileInputRef = useRef(null);
  const datasetFileInputRef = useRef(null);
  const chatEndRef = useRef(null);

  // 6. Active Directory Indicator State
  const [activeDir, setActiveDir] = useState('');

  // 7. Hardware & Datasets Diagnostics
  const [datasets, setDatasets] = useState([]);
  const [trainingJobs, setTrainingJobs] = useState([]);
  const [systemServices, setSystemServices] = useState([]);
  const [isUploadingDataset, setIsUploadingDataset] = useState(false);
  
  // Forms & Selections
  const [trainConfig, setTrainConfig] = useState({ model_base: 'llama-3', dataset_id: '', epochs: 3, lr: 0.0002 });
  const [toggles, setToggles] = useState({ context: true, autoSave: true, webSearch: false, codeInterpreter: false });

  // Inspection states
  const [selectedDatasetId, setSelectedDatasetId] = useState(null);
  const [datasetVectors, setDatasetVectors] = useState([]);
  const [isValidatingDataset, setIsValidatingDataset] = useState(false);

  // Auto-scroll chat window
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentMessages]);

  // Strip trailing slashes safely on host strings
  const sanitizeHost = (host) => {
    if (!host) return '';
    return host.replace(/\/+$/, '');
  };

  // Sync Subsystem Hardware Cores
  const fetchSubsystemMetrics = async () => {
    try {
      const dRes = await fetch('http://localhost:8000/api/datasets');
      if (dRes.ok) {
        const dData = await dRes.json();
        const activeDatasets = dData.datasets || [];
        setDatasets(activeDatasets);
        // Automatically default dataset target in Train runner if not set
        if (activeDatasets.length > 0 && !trainConfig.dataset_id) {
          setTrainConfig(prev => ({ ...prev, dataset_id: activeDatasets[0].id }));
        }
      }

      const tRes = await fetch('http://localhost:8000/api/training/jobs');
      if (tRes.ok) {
        const tData = await tRes.json();
        setTrainingJobs(tData.jobs || []);
      }

      const docRes = await fetch('http://localhost:8000/api/docker/status');
      if (docRes.ok) {
        const docData = await docRes.json();
        setSystemServices(docData.containers || []);
      }

      const dirRes = await fetch('http://localhost:8000/api/workspace/directory');
      if (dirRes.ok) {
        const dirData = await dirRes.json();
        setActiveDir(dirData.directory);
      }
    } catch (e) {
      console.error("[ERROR] Failed to fetch subsystem metrics:", e);
    }
  };

  useEffect(() => {
    fetchSubsystemMetrics();
    const interval = setInterval(fetchSubsystemMetrics, 3000);
    return () => clearInterval(interval);
  }, []);

  // Fetch vector lines when dataset changes
  useEffect(() => {
    const fetchVectors = async () => {
      if (!selectedDatasetId) return;
      try {
        const res = await fetch(`http://localhost:8000/api/datasets/${selectedDatasetId}/vectors`);
        if (res.ok) {
          const data = await res.json();
          setDatasetVectors(data.lines || []);
        } else {
          setDatasetVectors(["[ERROR] Failed to fetch vector arrays for this dataset."]);
        }
      } catch (err) {
        console.error("[ERROR] Failed to fetch dataset vectors:", err);
        setDatasetVectors(["[ERROR] Network core timeout fetching vectors."]);
      }
    };
    fetchVectors();
  }, [selectedDatasetId]);

  // Sync Global Active Model Core Mappings across all Enabled API Connections
  const syncModels = async () => {
    let completeList = [];

    for (let config of apiConfigs) {
      if (!config.enabled) continue;
      
      const sanitizedUrl = sanitizeHost(config.baseUrl);
      try {
        const res = await fetch('http://localhost:8000/api/fetch-models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: config.provider,
            api_key: config.apiKey,
            local_host: config.provider === 'ollama' ? sanitizedUrl : undefined,
            custom_url: (config.provider === 'custom' || config.provider === 'openai') ? sanitizedUrl : undefined
          })
        });
        if (res.ok) {
          const data = await res.json();
          data.models?.forEach(m => {
            completeList.push({
              name: `${config.name}: ${m}`,
              provider: config.provider,
              id: m,
              key: config.apiKey,
              customUrl: (config.provider === 'custom' || config.provider === 'openai') ? sanitizedUrl : undefined
            });
          });
        }
      } catch (e) {
        console.error(`[ERROR] Sync failed for provider "${config.name}":`, e);
      }
    }

    // Dynamic scan and auto-detect models
    try {
      const res = await fetch('http://localhost:8000/api/models/autodetect');
      if (res.ok) {
        const data = await res.json();
        data.engines?.forEach(engine => {
          if (engine.status === 'Connected') {
            engine.models?.forEach(m => {
              const modelName = `${engine.name}: ${m}`;
              // Avoid duplicate if already configured
              if (!completeList.some(existing => existing.name === modelName)) {
                completeList.push({
                  name: modelName,
                  provider: engine.provider,
                  id: m,
                  key: null,
                  customUrl: engine.url
                });
              }
            });
          }
        });
      }
    } catch (e) {
      console.error("[ERROR] Failed autodetecting local models in syncModels:", e);
    }

    setAvailableModels(completeList);
    if (completeList.length > 0) {
      if (!selectedModel || !completeList.some(m => m.name === selectedModel)) {
        setSelectedModel(completeList[0].name);
      }
    } else {
      setSelectedModel('');
    }
  };

  useEffect(() => { 
    syncModels(); 
  }, [apiConfigs]);

  useEffect(() => {
    if (!isInitialized) return;
    const visibleNames = visibleAvailableModels.map(m => m.name);
    if (visibleNames.length > 0 && !visibleNames.includes(selectedModel)) {
      setSelectedModel(visibleNames[0]);
    }
  }, [visibleModels, availableModels, isInitialized]);

  const handleToggle = (key) => {
    setToggles(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCreateProject = () => {
    setPromptModal({ visible: true, title: 'Name Workspace:', value: '', type: 'create_workspace', data: null });
  };

  const handleRenameProject = (id) => {
    const proj = projects.find(p => p.id === id);
    if (!proj) return;
    setPromptModal({ visible: true, title: 'Rename Workspace:', value: proj.name, type: 'rename_workspace', data: { id, oldName: proj.name } });
  };

  const handlePromptSubmit = async () => {
    const { type, value, data } = promptModal;
    setPromptModal({ visible: false, title: '', value: '', type: '', data: null });
    
    if (!value.trim()) return;

    if (type === 'create_workspace') {
      const newId = `w_${Date.now()}`;
      const newProj = {
        id: newId,
        name: value.trim(),
        filesIndexed: 0,
        contextLines: 0,
        messages: [],
        tokenUsage: 0
      };
      setProjects(prev => [...prev, newProj]);
      setActiveProjectId(newId);
      setCurrentView('chat');

      try {
        await fetch('http://localhost:8000/api/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newProj)
        });
      } catch (err) {
        console.error("Failed to create workspace on backend", err);
      }
    } else if (type === 'rename_workspace') {
      if (value.trim() === data.oldName) return;
      
      setProjects(prev => prev.map(p => p.id === data.id ? { ...p, name: value.trim() } : p));
      try {
        await fetch(`http://localhost:8000/api/chats/${data.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: value.trim() })
        });
      } catch (err) {
        console.error("Failed to rename workspace on backend", err);
      }
    } else if (type === 'change_dir') {
      try {
        const res = await fetch('http://localhost:8000/api/workspace/directory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: value.trim() })
        });
        if (res.ok) {
          const resData = await res.json();
          setActiveDir(resData.directory);
          const systemMsg = {
            role: 'system',
            content: `[SYS_EVENT]: Active working directory updated to: "${resData.directory}". Found ${resData.files_count} file indexes.`
          };
          
          const targetProj = projects.find(p => p.id === activeProjectId);
          if (targetProj) {
            const updatedMsg = [...targetProj.messages, systemMsg];
            const newFilesIndexed = resData.files_count;
            
            setProjects(prev => prev.map(p => {
              if (p.id === activeProjectId) {
                return { ...p, filesIndexed: newFilesIndexed, messages: updatedMsg };
              }
              return p;
            }));
            
            syncProjectMessages(activeProjectId, updatedMsg, undefined, newFilesIndexed);
          }
        } else {
          const err = await res.json();
          alert(`Failed to change directory: ${err.detail || 'Directory unreachable'}`);
        }
      } catch (err) {
        console.error(err);
        alert("Connection error setting system directory.");
      }
    }
  };

  const handleDeleteProject = async (id) => {
    if (projects.length <= 1) {
      alert("CANNOT DELETE LAST REMAINING WORKSPACE.");
      return;
    }
    if (!window.confirm("WARNING: PERMANENTLY DELETE WORKSPACE AND ALL LOGS?")) return;
    
    setProjects(prev => prev.filter(p => p.id !== id));
    if (activeProjectId === id) {
      const remaining = projects.filter(p => p.id !== id);
      if (remaining.length > 0) setActiveProjectId(remaining[0].id);
    }
    try {
      await fetch(`http://localhost:8000/api/chats/${id}`, {
        method: 'DELETE'
      });
    } catch (err) {
      console.error("Failed to delete workspace on backend", err);
    }
  };

  const handleContextMenu = (e, id) => {
    e.preventDefault();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, projectId: id });
  };
  
  useEffect(() => {
    const handleClick = () => {
      setContextMenu(prev => {
        if (!prev.visible) return prev;
        return { ...prev, visible: false };
      });
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  const handleNewSessionBlock = () => {
    const timeStr = new Date().toLocaleTimeString();
    const systemMsg = {
      role: 'system',
      content: `[SYS_EVENT]: --- NEW RUNTIME SESSION BLOCK INITIATED AT ${timeStr} ---`
    };
    const targetProj = projects.find(p => p.id === activeProjectId);
    if (targetProj) {
      const updatedMessages = [...targetProj.messages, systemMsg];
      setProjects(prev => prev.map(p => p.id === activeProjectId ? { ...p, messages: updatedMessages } : p));
      syncProjectMessages(activeProjectId, updatedMessages);
    }
    setCurrentView('chat');
  };

  const handleExportLogs = () => {
    if (currentMessages.length === 0) {
      alert("SESSION LOG BUFFER IS EMPTY. NOTHING TO EXPORT.");
      return;
    }
    const logHeader = `==================================================\nBIFROST SYSTEM RUN RUN LOG\nWORKSPACE: ${activeProject.name}\nEXPORTED : ${new Date().toLocaleString()}\n==================================================\n\n`;
    const logBody = currentMessages.map(m => {
      const roleStr = m.role === 'user' ? '[USER_INPUT]' : (m.role === 'system' ? '[SYS_INDEXER]' : `[BIFROST: ${m.model.toUpperCase()}]`);
      return `${roleStr}\n--------------------------------------------------\n${m.content}\n\n`;
    }).join('');
    
    const blob = new Blob([logHeader + logBody], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${activeProject.name.toLowerCase().replace(/\s+/g, '_')}_run.log`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Wipes active context window logs
  const handleResetBuffer = () => {
    if (window.confirm("CRITICAL HALT: Clears the active workspace context memory logs and resets byte count usage to 0. Proceed?")) {
      setProjects(prev => prev.map(p => {
        if (p.id === activeProjectId) {
          return {
            ...p,
            messages: [],
            tokenUsage: 0
          };
        }
        return p;
      }));
      syncProjectMessages(activeProjectId, [], 0);
    }
  };

  // Stages files to be attached to the next user message
  const handleFileAttachment = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    if (file.type.startsWith('image/')) {
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        setAttachedFiles(prev => [...prev, { type: 'image', url: event.target.result, name: file.name }]);
      };
    } else {
      reader.readAsText(file);
      reader.onload = (event) => {
        setAttachedFiles(prev => [...prev, { type: 'text', content: event.target.result, name: file.name }]);
      };
    }
    e.target.value = '';
  };

  const handleSetDirectory = async () => {
    if (window.require) {
      try {
        const { ipcRenderer } = window.require('electron');
        const selectedPath = await ipcRenderer.invoke('select-directory');
        if (selectedPath) {
          const res = await fetch('http://localhost:8000/api/workspace/directory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: selectedPath })
          });
          
          if (res.ok) {
            const resData = await res.json();
            setActiveDir(resData.directory);
            const systemMsg = {
              role: 'system',
              content: `[SYS_EVENT]: Active working directory updated to: "${resData.directory}". Found ${resData.files_count} file indexes.`
            };
            
            const targetProj = projects.find(p => p.id === activeProjectId);
            if (targetProj) {
              const updatedMsg = [...targetProj.messages, systemMsg];
              setProjects(prev => prev.map(p => {
                if (p.id === activeProjectId) {
                  return { ...p, filesIndexed: resData.files_count, messages: updatedMsg };
                }
                return p;
              }));
              syncProjectMessages(activeProjectId, updatedMsg);
            }
          }
        }
      } catch (err) {
        console.error("Failed to set directory via IPC:", err);
      }
    } else {
      // Fallback for non-Electron environments (dev mode in browser)
      try {
        const pickRes = await fetch('http://localhost:8000/api/workspace/pick-directory');
        if (pickRes.ok) {
          const pickData = await pickRes.json();
          if (pickData.directory) {
            const res = await fetch('http://localhost:8000/api/workspace/directory', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: pickData.directory })
            });
            if (res.ok) {
              const resData = await res.json();
              setActiveDir(resData.directory);
              const systemMsg = { role: 'system', content: `[SYS_EVENT]: Active working directory updated to: "${resData.directory}". Found ${resData.files_count} file indexes.` };
              const targetProj = projects.find(p => p.id === activeProjectId);
              if (targetProj) {
                const updatedMsg = [...targetProj.messages, systemMsg];
                setProjects(prev => prev.map(p => p.id === activeProjectId ? { ...p, filesIndexed: resData.files_count, messages: updatedMsg } : p));
                syncProjectMessages(activeProjectId, updatedMsg);
              }
            }
          }
        } else {
          setPromptModal({ visible: true, title: 'Set Working Directory', value: activeDir || '', type: 'change_dir', data: null });
        }
      } catch (err) {
        setPromptModal({ visible: true, title: 'Set Working Directory', value: activeDir || '', type: 'change_dir', data: null });
      }
    }
  };

  // Structured System Panic & Markdown Stream Evaluation Node
  const parseTerminalText = (text) => {
    if (Array.isArray(text)) {
      return text.map((item, index) => {
        if (item.type === 'text') return <div key={index} style={{ marginBottom: '10px' }}>{parseTerminalText(item.text)}</div>;
        if (item.type === 'image_url') return <img key={index} src={item.image_url.url} alt="User attachment" style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '5px', marginTop: '10px' }} />;
        return null;
      });
    }

    if (!text || typeof text !== 'string') return '';
    let cleanedText = text;

    if (cleanedText.includes('[ERROR]:') || cleanedText.includes('HTTP Error') || cleanedText.includes('[CRITICAL ROUTING FAILURE]') || cleanedText.includes('429')) {
      try {
        const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
        let errorData = null;
        if (jsonMatch) {
          try {
            const parsedObj = JSON.parse(jsonMatch[0]);
            errorData = parsedObj.error || parsedObj;
          } catch (e) {
            console.error("Failed to parse inner JSON error:", e);
          }
        }

        const title = errorData?.title || "Operation Failed";
        const suggestion = errorData?.actionable_suggestion || "Something went wrong on our end. Please try again or restart the local server.";
        const category = errorData?.category || "unknown";

        return (
          <div className="soft-error-alert" style={{
            margin: '12px 0',
            padding: '16px',
            borderRadius: '8px',
            backgroundColor: '#2d1a22',
            border: '1px solid #ff4a75',
            color: '#ffd0dc',
            fontFamily: 'sans-serif',
            boxShadow: '0 4px 12px rgba(255, 74, 117, 0.15)',
            textAlign: 'left'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span style={{ fontSize: '1.2rem', color: '#ff4a75' }}>⚠️</span>
              <strong style={{ fontSize: '1.1rem', color: '#ff4a75' }}>{title}</strong>
            </div>
            <p style={{ margin: '0 0 14px 0', fontSize: '0.95rem', lineHeight: '1.4', color: '#fca5a5' }}>
              {suggestion}
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              {category === 'authentication' && (
                <button className="retro-btn" onClick={(e) => { e.stopPropagation(); setCurrentView('settings'); }} style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)', fontSize: '0.85rem', padding: '4px 12px' }}>
                  Open Setup
                </button>
              )}
              {category === 'context_limit' && (
                <button className="retro-btn" onClick={(e) => { e.stopPropagation(); handleResetBuffer(); }} style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)', fontSize: '0.85rem', padding: '4px 12px' }}>
                  Reset Context
                </button>
              )}
              {category === 'connection' && (
                <button className="retro-btn" onClick={(e) => { e.stopPropagation(); handleAutoDetect(); }} style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)', fontSize: '0.85rem', padding: '4px 12px' }}>
                  Retry Connections
                </button>
              )}
            </div>
          </div>
        );
      } catch (err) {
        console.error("Failed to parse and render error alert:", err);
      }

      // Safe fallback if parsing fails completely
      return (
        <div className="soft-error-alert" style={{
          margin: '12px 0',
          padding: '16px',
          borderRadius: '8px',
          backgroundColor: '#2d1a22',
          border: '1px solid #ff4a75',
          color: '#ffd0dc',
          fontFamily: 'sans-serif',
          textAlign: 'left'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '1.2rem', color: '#ff4a75' }}>⚠️</span>
            <strong style={{ fontSize: '1.1rem', color: '#ff4a75' }}>Service Error</strong>
          </div>
          <p style={{ margin: 0, fontSize: '0.95rem', color: '#fca5a5' }}>
            Something went wrong on our end. Please try again or restart the local server.
          </p>
        </div>
      );
    }

    cleanedText = cleanedText.replace(/```text/g, '').replace(/```/g, '');
    const parts = cleanedText.split(/\*\*([\s\S]*?)\*\*/g);
    
    return parts.map((part, index) => {
      if (index % 2 === 1) {
        return <strong key={index} style={{ color: '#39ff14', fontWeight: 'bold' }}>{part}</strong>;
      }
      return part;
    });
  };

  // Helper color-codes for assistant chat bubble borders
  const getModelBubbleClass = (modelId) => {
    if (!modelId) return '';
    const m = modelId.toLowerCase();
    if (m.includes('gpt') || m.includes('openai')) return 'gpt';
    if (m.includes('gemini') || m.includes('google')) return 'gemini';
    if (m.includes('llama') || m.includes('ollama')) return 'llama';
    if (m.includes('simulator') || m.includes('mock')) return 'sim';
    return '';
  };

  // Handle Input Changes for @ Mention list popup autocompletes
  const handleInputChange = (val) => {
    setInput(val);
    const lastWordMatch = val.match(/@([a-zA-Z0-9_.-]*)$/);
    if (lastWordMatch) {
      setShowMentionList(true);
      setMentionFilter(lastWordMatch[1]);
      setSelectedMentionIndex(0);
    } else {
      setShowMentionList(false);
    }
  };

  // Filtered available models based on mentions
  const getFilteredMentions = () => {
    return visibleAvailableModels.filter(m => {
      const friendly = getModelFriendlyName(m).toLowerCase();
      const id = m.id.toLowerCase();
      const filter = mentionFilter.toLowerCase();
      return friendly.includes(filter) || id.includes(filter);
    });
  };

  // Injects selected model mention tag directly into the input bar
  const insertMention = (model) => {
    const alias = getModelAlias(model);
    const updatedInput = input.replace(/@([a-zA-Z0-9_.-]*)$/, `@${alias} `);
    setInput(updatedInput);
    setShowMentionList(false);
  };

  // Matches a friendly @alias to the best model configuration object
  const findModelForAlias = (alias) => {
    const aliasLower = alias.toLowerCase();
    
    // 1. Check if the active selectedModel matches the alias
    const currentSelectedModelObj = availableModels.find(m => m.name === selectedModel);
    if (currentSelectedModelObj && getModelAlias(currentSelectedModelObj) === aliasLower) {
      return currentSelectedModelObj;
    }
    
    // 2. Check visible models matching the alias
    const matchedVisible = visibleAvailableModels.find(m => getModelAlias(m) === aliasLower);
    if (matchedVisible) return matchedVisible;
    
    // 3. Check all available models matching the alias
    const matchedAvailable = availableModels.find(m => getModelAlias(m) === aliasLower);
    if (matchedAvailable) return matchedAvailable;
    
    // 4. Fallback to direct ID/name matching
    const directMatch = availableModels.find(m => m.id.toLowerCase() === aliasLower || m.name.toLowerCase().includes(aliasLower));
    return directMatch || null;
  };

  // Sequential Multi-Agent chat executor loop
  const handleSendMessage = async () => {
    if ((!input.trim() && attachedFiles.length === 0) || isGenerating || visibleAvailableModels.length === 0) return;

    const rawInput = input;
    const currentFiles = [...attachedFiles];
    setInput('');
    setAttachedFiles([]);
    setShowMentionList(false);
    setIsGenerating(true);

    // 1. Parse @ Mentions from message
    const mentionRegex = /@([a-zA-Z0-9_.:-]+)/g;
    const mentions = [];
    let match;
    while ((match = mentionRegex.exec(rawInput)) !== null) {
      const mentionedId = match[1];
      const matchedModel = findModelForAlias(mentionedId);
      if (matchedModel && !mentions.some(m => m.id === matchedModel.id)) {
        mentions.push(matchedModel);
      }
    }

    // 2. Add user message block
    let messageContent;
    if (currentFiles.length > 0) {
      messageContent = [];
      if (rawInput.trim()) messageContent.push({ type: "text", text: rawInput });
      currentFiles.forEach(f => {
        if (f.type === 'image') messageContent.push({ type: "image_url", image_url: { url: f.url } });
        else messageContent.push({ type: "text", text: `[FILE: ${f.name}]\n${f.content}` });
      });
    } else {
      messageContent = rawInput;
    }
    const userMsg = { role: 'user', content: messageContent };
    let currentHistory = [...currentMessages, userMsg];
    setProjects(prev => prev.map(p => p.id === activeProjectId ? { ...p, messages: currentHistory } : p));
    
    // Sync user message to backend
    await syncProjectMessages(activeProjectId, currentHistory);

    // Determine target sequential models list
    let targetModels = [];
    if (mentions.length > 0) {
      // @mentions always take highest priority
      targetModels = mentions;
    } else if (selectedParallelModels.length > 0) {
      // Multi-Agent: user-selected responders from config page
      targetModels = selectedParallelModels
        .map(name => visibleAvailableModels.find(m => m.name === name))
        .filter(Boolean);
      if (targetModels.length === 0) {
        // Fallback if all selected parallel models were toggled invisible
        const selectedModelObj = availableModels.find(m => m.name === selectedModel);
        targetModels = selectedModelObj ? [selectedModelObj] : (visibleAvailableModels.length > 0 ? [visibleAvailableModels[0]] : []);
      }
    } else {
      // Single model: use selected dropdown model
      const selectedModelObj = availableModels.find(m => m.name === selectedModel);
      targetModels = selectedModelObj ? [selectedModelObj] : (visibleAvailableModels.length > 0 ? [visibleAvailableModels[0]] : []);
    }

    // 3. Sequential Coordinator Loop
    for (let i = 0; i < targetModels.length; i++) {
      const activeModelObj = targetModels[i];
      const aiIndex = currentHistory.length;

      // Append blank assistant block tagged with model info
      const blankAiMsg = { role: 'assistant', content: '', model: activeModelObj.id, provider: activeModelObj.provider };
      currentHistory = [...currentHistory, blankAiMsg];
      
      setProjects(prev => prev.map(p => p.id === activeProjectId ? { ...p, messages: currentHistory } : p));
      
      // Sync blank message to backend
      await syncProjectMessages(activeProjectId, currentHistory);

      let finalTokenUsage = activeProject ? (activeProject.tokenUsage || 0) : 0;
      try {
        const baseSysPrompt = modelPersonalities[activeModelObj.id] || systemPrompt || "";
        const injectedSysPrompt = activeDir ? `[SYSTEM CONTEXT]\nCurrent Active Directory: ${activeDir}\n\n${baseSysPrompt}` : baseSysPrompt;
        
        const response = await fetch('http://localhost:8000/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: activeModelObj.provider,
            model: activeModelObj.id,
            messages: currentHistory.slice(0, aiIndex), // pass context history excluding the active blank bubble
            api_key: activeModelObj.key,
            local_host: configForProvider(activeModelObj.provider)?.baseUrl || '',
            custom_url: activeModelObj.customUrl ? sanitizeHost(activeModelObj.customUrl) : undefined,
            temperature: parseFloat(temperature) || 0.7,
            max_tokens: parseInt(maxTokens) || 4096,
            system_prompt: injectedSysPrompt || undefined,
            capabilities: toggles,
            files_indexed: activeProject ? activeProject.filesIndexed : 0,
            context_lines: activeProject ? activeProject.contextLines : 0
          })
        });

        if (!response.body) throw new Error("Unable to read response stream.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let cumulativeText = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6));
                let usageInc = 0;
                if (parsed.error) {
                  cumulativeText += `\n[ERROR]: ${JSON.stringify(parsed.error)}`;
                } else if (parsed.content) {
                  cumulativeText += parsed.content;
                  usageInc = parsed.usage_increment || parsed.content.length;
                }

                currentHistory = [...currentHistory];
                currentHistory[aiIndex] = { 
                  role: 'assistant', 
                  content: cumulativeText, 
                  model: activeModelObj.id, 
                  provider: activeModelObj.provider 
                };

                finalTokenUsage = Math.min((activeBufferLimitMb * 1024 * 1024), finalTokenUsage + usageInc);

                setProjects(prev => prev.map(p => {
                  if (p.id === activeProjectId) {
                    return { ...p, messages: currentHistory, tokenUsage: finalTokenUsage };
                  }
                  return p;
                }));
              } catch (e) {}
            }
          }
        }
        
        // Sync final content to backend when streaming finishes successfully
        await syncProjectMessages(activeProjectId, currentHistory, finalTokenUsage);

      } catch (err) {
        const errorObj = { code: "500", status: "CONNECTION_FAILURE", message: err.message };
        currentHistory = [...currentHistory];
        currentHistory[aiIndex] = { 
          role: 'assistant', 
          content: `[ERROR]: ${JSON.stringify(errorObj)}`, 
          model: activeModelObj.id, 
          provider: activeModelObj.provider 
        };
        setProjects(prev => prev.map(p => p.id === activeProjectId ? { ...p, messages: currentHistory } : p));
        
        // Sync final error content to backend
        await syncProjectMessages(activeProjectId, currentHistory, finalTokenUsage);
      }
    }

    setIsGenerating(false);
  };

  const configForProvider = (provider) => {
    return apiConfigs.find(c => c.provider === provider && c.enabled);
  };

  // Upload local dataset file to datasets database
  const handleDatasetFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    setIsUploadingDataset(true);
    try {
      const res = await fetch('http://localhost:8000/api/datasets/upload', {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Staging SUCCESS: Staged "${data.dataset.name}" successfully.`);
        fetchSubsystemMetrics();
        // default select newly uploaded dataset in runner config
        setTrainConfig(prev => ({ ...prev, dataset_id: data.dataset.id }));
      } else {
        const err = await res.json();
        alert(`Staging Failed: ${err.detail || 'Ingestion breakdown.'}`);
      }
    } catch (err) {
      console.error(err);
      alert("[PANIC] Network connection failed staging dataset.");
    } finally {
      setIsUploadingDataset(false);
    }
  };

  const triggerDatasetValidate = async (id) => {
    if (!id) return;
    setIsValidatingDataset(true);
    try {
      const res = await fetch('http://localhost:8000/api/datasets/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset_id: id })
      });
      if (res.ok) {
        fetchSubsystemMetrics();
      }
    } catch (err) {
      console.error("[ERROR] Failed validating dataset:", err);
    } finally {
      setIsValidatingDataset(false);
    }
  };

  const triggerTrainingJob = async () => {
    try {
      const res = await fetch('http://localhost:8000/api/training/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_base: trainConfig.model_base,
          dataset_id: trainConfig.dataset_id,
          epochs: parseInt(trainConfig.epochs) || 3,
          learning_rate: parseFloat(trainConfig.lr) || 0.0002
        })
      });
      if (res.ok) {
        fetchSubsystemMetrics();
        setCurrentView('train');
      } else {
        const err = await res.json();
        alert(`Training Launch Failed: ${err.detail || 'Inference error'}`);
      }
    } catch (err) {
      console.error("[ERROR] Failed starting training job:", err);
    }
  };

  const toggleDockerContainer = async (cid) => {
    setSystemServices(prev => prev.map(c => {
      if (c.id === cid) {
        const nextStatus = c.status === 'RUNNING' ? 'EXITED' : 'RUNNING';
        return { ...c, status: nextStatus, cpu: nextStatus === 'RUNNING' ? '0.5%' : '0.0%' };
      }
      return c;
    }));

    try {
      const res = await fetch(`http://localhost:8000/api/docker/toggle?container_id=${cid}`, { 
        method: 'POST' 
      });
      if (res.ok) {
        fetchSubsystemMetrics();
      }
    } catch (err) {
      console.error("[ERROR] Failed docker toggle:", err);
      fetchSubsystemMetrics();
    }
  };

  // Dynamics settings mutations
  const updateApiConfig = (id, fields) => {
    setApiConfigs(prev => prev.map(c => c.id === id ? { ...c, ...fields } : c));
  };

  const addApiConfig = () => {
    setApiConfigs(prev => [...prev, {
      id: `api_${Date.now()}`,
      name: 'Custom Endpoint',
      provider: 'custom',
      baseUrl: 'http://127.0.0.1:8000',
      apiKey: '',
      enabled: true
    }]);
  };

  const deleteApiConfig = async (id) => {
    setApiConfigs(prev => prev.filter(c => c.id !== id));
    try {
      await fetch(`http://localhost:8000/api/settings/configs/${id}`, {
        method: 'DELETE'
      });
    } catch (err) {
      console.error("Failed to delete API config on backend", err);
    }
  };

  const activeModelObj = availableModels.find(m => m.name === selectedModel) || visibleAvailableModels[0] || availableModels[0];
  const activeModelDisplayId = activeModelObj ? activeModelObj.id : 'NONE';

  const localModels = visibleAvailableModels.filter(m => m.provider === 'ollama' || m.provider === 'custom');
  const cloudModels = visibleAvailableModels.filter(m => m.provider === 'openai' || m.provider === 'gemini');

  return (
    <div className="workspace">
      <div className="scanlines"></div>
      
      {/* 1. LEFT SIDEBAR */}
      {leftOpen && (
        <div className="left-sidebar" onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h1 style={{ color: 'var(--accent-red)', textShadow: '0 0 10px rgba(255,0,85,0.5)', margin: '0', cursor: 'pointer', letterSpacing: '1.5px' }} onClick={(e) => { e.stopPropagation(); setCurrentView('chat'); }}>BIFROST</h1>
            <button className="retro-btn" onClick={(e) => { e.stopPropagation(); setLeftOpen(false); }} style={{ padding: '2px 6px' }}>◀</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            <div className="nav-section">// SERVICES</div>
            <div className={`nav-item ${currentView === 'settings' ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); setCurrentView('settings'); }}>⚙️ SETTINGS & API</div>
            <div className={`nav-item ${currentView === 'model-setup' ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); setCurrentView('model-setup'); }}>🔍 LOCAL SCAN</div>
            <div className="nav-item" style={{ color: 'var(--terminal-green)' }} onClick={(e) => { e.stopPropagation(); syncModels(); }}>⚡ RE-SYNC</div>

            <div className="nav-section">// TRAINING</div>
            <div className={`nav-item ${currentView === 'train' ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); setCurrentView('train'); }}>🧠 TRAIN</div>
            <div className={`nav-item ${currentView === 'datasets' ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); setCurrentView('datasets'); }}>📁 DATASETS</div>

            <div className="nav-section">// WORKSPACES</div>
            {projects.map(p => (
              <div 
                key={p.id} 
                className={`project-nav-item ${activeProjectId === p.id && currentView === 'chat' ? 'active' : ''}`} 
                onClick={(e) => { e.stopPropagation(); setActiveProjectId(p.id); setCurrentView('chat'); }}
                onContextMenu={(e) => handleContextMenu(e, p.id)}
              >
                <span style={{ color: activeProjectId === p.id ? 'var(--terminal-green)' : 'var(--text-dim)', fontSize: '0.75rem', marginTop: '3px' }}>●</span>
                <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div className="project-name">{p.name}</div>
                  <div className="project-meta">{p.filesIndexed} files | {(p.tokenUsage || 0).toLocaleString()} bytes</div>
                </div>
              </div>
            ))}
            <button className="retro-btn" onClick={(e) => { e.stopPropagation(); handleCreateProject(); }} style={{ width: '100%', marginTop: '8px', fontSize: '1.1rem', justifyContent: 'center' }}>
              + CREATE WORKSPACE
            </button>
            
            {contextMenu.visible && (
              <div 
                className="context-menu" 
                style={{ 
                  position: 'fixed', 
                  top: contextMenu.y, 
                  left: contextMenu.x, 
                  backgroundColor: 'var(--panel-blue)', 
                  border: '2px solid var(--panel-border)', 
                  zIndex: 9999, 
                  boxShadow: '4px 4px 0px rgba(0,0,0,0.8)' 
                }}
              >
                <div 
                  className="mention-item" 
                  onClick={() => handleRenameProject(contextMenu.projectId)}
                >
                  Rename Workspace
                </div>
                <div 
                  className="mention-item" 
                  onClick={() => handleDeleteProject(contextMenu.projectId)}
                  style={{ color: 'var(--accent-red)' }}
                >
                  Delete Workspace
                </div>
              </div>
            )}

            <div className="nav-section">// SYSTEM STATUS</div>
            <div className={`nav-item ${currentView === 'docker' ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); setCurrentView('docker'); }}>⚓ SERVICES</div>
          </div>

          <div style={{ paddingTop: '15px', borderTop: '2px solid var(--panel-border)', marginTop: '10px' }}>
            <div className="retro-card" style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
              <div style={{ width: '10px', height: '10px', backgroundColor: 'var(--terminal-green)', borderRadius: '50%', boxShadow: '0 0 8px var(--terminal-green)' }}></div>
              <div>
                <div style={{ fontSize: '1.1rem' }}>CONNECTIONS</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{availableModels.length} active connections</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. CENTER WORKING VIEWPORT */}
      <div className="center-pane">
        <div className="top-bar">
          <div className="top-bar-left">
            {!leftOpen && <button className="retro-btn" onClick={() => setLeftOpen(true)}>▶ MENU</button>}
            
            {currentView === 'chat' ? (
              <>
                <select className="project-selector" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} style={{ color: 'var(--terminal-green)', borderColor: 'var(--terminal-green)' }}>
                  {visibleAvailableModels.length === 0 ? (
                    <option value="">NO ACTIVE MODELS (CONNECT IN SETTINGS)</option>
                  ) : (
                    <>
                      {localModels.length > 0 && (
                        <optgroup label="Local Models">
                          {localModels.map((m, i) => <option key={i} value={m.name}>{m.name}</option>)}
                        </optgroup>
                      )}
                      {cloudModels.length > 0 && (
                        <optgroup label="Cloud Models">
                          {cloudModels.map((m, i) => <option key={i} value={m.name}>{m.name}</option>)}
                        </optgroup>
                      )}
                    </>
                  )}
                </select>
                
                <select className="project-selector" value={activeProjectId} onChange={(e) => setActiveProjectId(e.target.value)}>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </>

            ) : (
              <span style={{ color: 'var(--accent-red)', fontSize: '1.2rem', fontWeight: 'bold' }}>
                SETTINGS // {currentView.toUpperCase()}
              </span>
            )}
          </div>
          
          <div className="top-bar-right" style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
            {currentView === 'chat' ? (
              <>
                <button className="retro-btn" onClick={(e) => { e.stopPropagation(); handleExportLogs(); }} title="Export message history">
                  💾 EXPORT LOGS
                </button>
                <button className="retro-btn" onClick={(e) => { e.stopPropagation(); setRightOpen(!rightOpen); }} style={{ backgroundColor: rightOpen ? 'var(--accent-red)' : 'transparent', color: rightOpen ? '#000' : 'var(--text-light)', borderColor: rightOpen ? 'var(--accent-red)' : 'var(--panel-border)' }} title="Toggle settings menu">
                  ⚙️ SETTINGS
                </button>
              </>
            ) : (
              <button className="retro-btn" onClick={(e) => { e.stopPropagation(); setCurrentView('chat'); }} style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }}>
                [X] CLOSE
              </button>
            )}
          </div>
        </div>

        {currentView === 'settings' && (
          <div className="settings-page" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
              <h2 style={{ color: 'var(--accent-red)', textShadow: '0 0 8px rgba(255,0,85,0.3)', textTransform: 'uppercase', margin: 0 }}>SETTINGS & API</h2>
              <button className="retro-btn" onClick={(e) => { e.stopPropagation(); setCurrentView('chat'); }} style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }}>◀ BACK TO WORKSPACE</button>
            </div>

            {/* === SECTION 0: CLIENT SETTINGS === */}
            {window.require && (
              <div style={{ marginBottom: '35px' }}>
                <div className="card-title" style={{ fontSize: '1.1rem', marginBottom: '10px' }}>APP BEHAVIOR</div>
                <div className="retro-card">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <label style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>WHEN CLOSING THE WINDOW:</label>
                      <select 
                        value={electronCloseBehavior} 
                        onChange={(e) => handleCloseBehaviorChange(e.target.value)}
                        className="project-selector" 
                        style={{ width: '100%', maxWidth: '300px' }}
                      >
                        <option value="ask">Ask every time</option>
                        <option value="background">Run in background (Tray)</option>
                        <option value="quit">Close completely</option>
                      </select>
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <label style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>DATA STORAGE PATH:</label>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', maxWidth: '500px' }}>
                        <input 
                          type="text" 
                          value={electronDataPath || 'Default (AppData)'} 
                          readOnly 
                          className="project-selector" 
                          style={{ flex: 1, backgroundColor: 'var(--panel-blue)', cursor: 'default' }} 
                        />
                        <button className="retro-btn" onClick={handleSelectDataPath}>CHANGE</button>
                      </div>
                      <span style={{ fontSize: '0.8rem', color: 'var(--accent-red)' }}>* Restart required after changing</span>
                    </div>
                    

                  </div>
                </div>
              </div>
            )}

            {/* === SECTION 1: API PROVIDERS === */}
            <div className="card-title" style={{ fontSize: '1.1rem', marginBottom: '10px' }}>API PROVIDERS</div>
            <button className="new-chat-btn" onClick={addApiConfig} style={{ marginBottom: '15px', display: 'inline-block' }}>
              + ADD API PROVIDER
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginBottom: '35px' }}>
              {apiConfigs.map(config => (
                <div key={config.id} className="retro-card" style={{ borderLeft: config.enabled ? '4px solid var(--terminal-green)' : '4px solid var(--text-dim)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.8fr 1.8fr 0.6fr 0.6fr', gap: '15px', alignItems: 'center' }}>
                    <div>
                      <label style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>NAME</label>
                      <input type="text" value={config.name} onChange={(e) => updateApiConfig(config.id, { name: e.target.value })} className="project-selector" style={{ width: '100%', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>PROVIDER</label>
                      <select value={config.provider} onChange={(e) => updateApiConfig(config.id, { provider: e.target.value })} className="project-selector" style={{ width: '100%' }}>
                        <option value="ollama">Ollama</option>
                        <option value="openai">OpenAI</option>
                        <option value="gemini">Gemini</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>URL</label>
                      <input type="text" value={config.baseUrl} onChange={(e) => updateApiConfig(config.id, { baseUrl: e.target.value })} className="project-selector" style={{ width: '100%', boxSizing: 'border-box' }} placeholder="http://localhost:11434" />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>API KEY</label>
                      <input type="password" value={config.apiKey} onChange={(e) => updateApiConfig(config.id, { apiKey: e.target.value })} className="project-selector" style={{ width: '100%', boxSizing: 'border-box' }} placeholder="sk-..." disabled={config.provider === 'ollama'} />
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <label style={{ fontSize: '0.9rem', color: 'var(--text-dim)', display: 'block' }}>ACTIVE</label>
                      <button className="retro-btn" onClick={() => updateApiConfig(config.id, { enabled: !config.enabled })} style={{ margin: '0 auto', fontSize: '1rem', borderColor: config.enabled ? 'var(--terminal-green)' : 'var(--text-dim)', color: config.enabled ? 'var(--terminal-green)' : 'var(--text-dim)' }}>
                        {config.enabled ? 'ENABLED' : 'DISABLED'}
                      </button>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <label style={{ fontSize: '0.9rem', color: 'var(--text-dim)', display: 'block' }}>REMOVE</label>
                      <button className="retro-btn" onClick={() => deleteApiConfig(config.id)} style={{ margin: '0 auto', fontSize: '1rem', borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }}>
                        DELETE
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* === SECTION 2: ACTIVE MODELS === */}
            <div style={{ borderTop: '3px solid var(--panel-border)', paddingTop: '25px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <div>
                  <div className="card-title" style={{ fontSize: '1.1rem', margin: 0 }}>ACTIVE MODELS</div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-dim)', marginTop: '4px' }}>
                    Toggle which discovered models appear in chat. Only active models show in the dropdown and respond to @mentions.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  <button className="retro-btn" style={{ fontSize: '0.95rem', padding: '3px 10px', borderColor: 'var(--terminal-green)', color: 'var(--terminal-green)' }}
                    onClick={() => {
                      const all = {};
                      availableModels.forEach(m => { all[m.name] = true; });
                      setVisibleModels(all);
                    }}>
                    ALL ON
                  </button>
                  <button className="retro-btn" style={{ fontSize: '0.95rem', padding: '3px 10px', borderColor: 'var(--text-dim)', color: 'var(--text-dim)' }}
                    onClick={() => {
                      const none = {};
                      availableModels.forEach(m => { none[m.name] = false; });
                      setVisibleModels(none);
                    }}>
                    ALL OFF
                  </button>
                </div>
              </div>

              {availableModels.length === 0 ? (
                <div className="retro-card" style={{ padding: '30px', textAlign: 'center', color: 'var(--text-dim)' }}>
                  No models discovered yet. Enable an API provider above and click <strong style={{ color: 'var(--terminal-green)' }}>⚡ RE-SYNC</strong> in the sidebar.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {availableModels.map((m, idx) => {
                    const isActive = visibleModels[m.name] !== false;
                    const isLocal = m.provider === 'ollama' || m.provider === 'custom';
                    return (
                      <div key={idx}
                        className="retro-card"
                        style={{
                          margin: 0,
                          padding: '10px 15px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          borderLeft: `3px solid ${isActive ? 'var(--terminal-green)' : 'var(--text-dim)'}`,
                          opacity: isActive ? 1 : 0.5,
                          transition: 'all 0.2s'
                        }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', overflow: 'hidden' }}>
                          <span style={{
                            fontSize: '0.85rem', padding: '1px 6px',
                            border: '1px solid',
                            borderColor: isLocal ? 'var(--terminal-green)' : 'var(--terminal-amber)',
                            color: isLocal ? 'var(--terminal-green)' : 'var(--terminal-amber)',
                            flexShrink: 0
                          }}>{m.provider.toUpperCase()}</span>
                          <span style={{ fontFamily: 'monospace', fontSize: '1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.id}</span>
                        </div>
                        <div
                          className={`toggle-switch ${isActive ? 'on' : ''}`}
                          style={{ flexShrink: 0 }}
                          onClick={() => setVisibleModels(prev => ({ ...prev, [m.name]: !isActive }))}
                        ></div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* === MULTI-AGENT CONFIG PAGE === */}
        {currentView === 'multi-agent' && (
          <div className="settings-page" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h2 style={{ color: 'var(--terminal-amber)', textShadow: '0 0 8px rgba(255,180,0,0.3)', margin: 0 }}>Multi-Agent Responders</h2>
              <button className="retro-btn" onClick={(e) => { e.stopPropagation(); setCurrentView('chat'); }} style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }}>◀ BACK TO WORKSPACE</button>
            </div>
            <div style={{ fontSize: '1rem', color: 'var(--text-dim)', marginBottom: '25px', lineHeight: '1.5' }}>
              Select which of your <strong style={{ color: 'var(--terminal-green)' }}>active models</strong> should respond to every message. Only models you've activated in <strong style={{ color: 'var(--terminal-amber)' }}>⚙️ API & Models</strong> appear here.
              <br />Use <strong style={{ color: 'var(--text-light)' }}>@mentions</strong> in chat to override this and target specific models.
            </div>

            {visibleAvailableModels.length === 0 ? (
              <div className="retro-card" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dim)' }}>
                No active models. Go to <strong style={{ color: 'var(--terminal-amber)', cursor: 'pointer' }} onClick={() => setCurrentView('settings')}>⚙️ API & Models</strong> and toggle some models on.
              </div>
            ) : (
              <>
                {/* Quick actions */}
                <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', alignItems: 'center' }}>
                  <button className="retro-btn" style={{ borderColor: 'var(--terminal-green)', color: 'var(--terminal-green)', fontSize: '1rem', padding: '5px 14px' }}
                    onClick={() => setSelectedParallelModels(visibleAvailableModels.map(m => m.name))}>
                    SELECT ALL
                  </button>
                  <button className="retro-btn" style={{ borderColor: 'var(--text-dim)', color: 'var(--text-dim)', fontSize: '1rem', padding: '5px 14px' }}
                    onClick={() => setSelectedParallelModels([])}>
                    CLEAR ALL
                  </button>
                  <div style={{ marginLeft: 'auto', fontSize: '1rem', color: 'var(--terminal-green)', fontWeight: 'bold' }}>
                    {selectedParallelModels.filter(name => visibleAvailableModels.some(m => m.name === name)).length} of {visibleAvailableModels.length} responding
                  </div>
                </div>

                {/* Model cards */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {visibleAvailableModels.map((m, idx) => {
                    const isSelected = selectedParallelModels.includes(m.name);
                    const friendly = getModelFriendlyName(m);
                    const isLocal = m.provider === 'ollama' || m.provider === 'custom';
                    return (
                      <div key={idx}
                        className="retro-card"
                        onClick={() => {
                          if (isSelected) {
                            setSelectedParallelModels(prev => prev.filter(n => n !== m.name));
                          } else {
                            setSelectedParallelModels(prev => [...prev, m.name]);
                          }
                        }}
                        style={{
                          margin: 0,
                          padding: '14px 18px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          cursor: 'pointer',
                          borderLeft: `4px solid ${isSelected ? 'var(--terminal-green)' : 'var(--panel-border)'}`,
                          backgroundColor: isSelected ? 'rgba(57,255,20,0.03)' : 'transparent',
                          transition: 'all 0.2s'
                        }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', overflow: 'hidden' }}>
                          {/* Checkbox indicator */}
                          <div style={{
                            width: '22px', height: '22px',
                            border: `2px solid ${isSelected ? 'var(--terminal-green)' : 'var(--text-dim)'}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            backgroundColor: isSelected ? 'rgba(57,255,20,0.15)' : 'transparent',
                            transition: 'all 0.2s', flexShrink: 0
                          }}>
                            {isSelected && <span style={{ color: 'var(--terminal-green)', fontWeight: 'bold', fontSize: '1rem' }}>✓</span>}
                          </div>
                          <div style={{ overflow: 'hidden' }}>
                            <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: isSelected ? 'var(--terminal-green)' : 'var(--text-light)' }}>
                              {friendly}
                            </div>
                            <div style={{ fontSize: '0.9rem', color: 'var(--text-dim)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m.id}
                            </div>
                          </div>
                        </div>
                        <span style={{
                          fontSize: '0.85rem', padding: '2px 8px',
                          border: '1px solid',
                          borderColor: isLocal ? 'var(--terminal-green)' : 'var(--terminal-amber)',
                          color: isLocal ? 'var(--terminal-green)' : 'var(--terminal-amber)',
                          flexShrink: 0
                        }}>
                          {isLocal ? 'LOCAL' : 'CLOUD'}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Personality section for selected models */}
                {selectedParallelModels.length > 0 && (
                  <div style={{ marginTop: '30px', borderTop: '2px solid var(--panel-border)', paddingTop: '20px' }}>
                    <div className="card-title" style={{ fontSize: '1.1rem', marginBottom: '12px' }}>RESPONDER PERSONALITIES</div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-dim)', marginBottom: '15px' }}>
                      Optionally assign a custom personality prompt to each responding model.
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {selectedParallelModels.map((name, i) => {
                        const m = visibleAvailableModels.find(v => v.name === name);
                        if (!m) return null;
                        return (
                          <div key={i} className="retro-card" style={{ margin: 0, padding: '10px 14px' }}>
                            <div style={{ fontSize: '1rem', fontWeight: 'bold', color: 'var(--terminal-green)', marginBottom: '6px' }}>
                              {getModelFriendlyName(m)} <span style={{ fontSize: '0.85rem', fontWeight: 'normal', color: 'var(--text-dim)' }}>({m.id})</span>
                            </div>
                            <textarea
                              value={modelPersonalities[m.id] || ''}
                              onChange={(e) => setModelPersonalities(prev => ({ ...prev, [m.id]: e.target.value }))}
                              className="project-selector"
                              style={{
                                width: '100%', height: '55px', fontFamily: 'monospace', fontSize: '0.9rem',
                                resize: 'vertical', boxSizing: 'border-box',
                                backgroundColor: '#000', border: '1px solid var(--panel-border)',
                                color: 'var(--text-light)', outline: 'none', padding: '6px'
                              }}
                              placeholder={`Custom personality for ${getModelFriendlyName(m)}... (e.g., "Be concise and technical")`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {currentView === 'model-setup' && (
          <div className="settings-page" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
              <h2 style={{ color: 'var(--accent-red)' }}>Model Setup</h2>
              <button className="retro-btn" onClick={(e) => { e.stopPropagation(); setCurrentView('chat'); }} style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }}>◀ BACK TO WORKSPACE</button>
            </div>

            <div className="custom-grid">
              {/* Local Service Discovery */}
              <div className="retro-card">
                <div className="card-title">Local Service Discovery</div>
                <p style={{ fontSize: '1.1rem', color: 'var(--text-dim)', marginBottom: '15px', lineHeight: '1.4' }}>
                  Auto-detect active local AI services running on loopback ports.
                </p>

                <button 
                  className="new-chat-btn" 
                  onClick={handleAutoDetect} 
                  disabled={isScanning}
                  style={{ width: '100%', justifyContent: 'center', marginBottom: '20px' }}
                >
                  {isScanning ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="spinner"></span> Scanning Services...
                    </span>
                  ) : 'Scan for Local Models'}
                </button>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {detectedEngines.map((engine, idx) => (
                    <div key={idx} className="retro-card" style={{ margin: 0, padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderColor: engine.status === 'Connected' ? 'var(--terminal-green)' : 'var(--panel-border)' }}>
                      <div>
                        <span style={{ fontWeight: 'bold', fontSize: '1.15rem' }}>{engine.name}</span>
                        <span style={{ fontSize: '0.9rem', color: 'var(--text-dim)', marginLeft: '10px' }}>({engine.url})</span>
                      </div>
                      <span style={{ 
                        color: engine.status === 'Connected' ? 'var(--terminal-green)' : 'var(--text-dim)', 
                        fontWeight: 'bold',
                        fontSize: '1.1rem'
                      }}>
                        {engine.status === 'Connected' ? 'Connected' : 'Not Running'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* GGUF Importer Panel */}
              <div className="retro-card">
                <div className="card-title">Register Custom Weight File (.gguf)</div>
                <p style={{ fontSize: '1.1rem', color: 'var(--text-dim)', marginBottom: '15px', lineHeight: '1.4' }}>
                  Import standalone GGUF weights into local Ollama storage.
                </p>

                <form onSubmit={handleImportGguf} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div>
                    <label style={{ fontSize: '0.95rem', color: 'var(--text-dim)', display: 'block', marginBottom: '5px' }}>
                      GGUF FILE ABSOLUTE PATH
                    </label>
                    <input 
                      type="text" 
                      value={ggufFilePath} 
                      onChange={(e) => setGgufFilePath(e.target.value)} 
                      placeholder="e.g. C:\models\llama3.gguf"
                      className="project-selector" 
                      style={{ width: '100%', boxSizing: 'border-box' }}
                      required
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.95rem', color: 'var(--text-dim)', display: 'block', marginBottom: '5px' }}>
                      CUSTOM MODEL NAME
                    </label>
                    <input 
                      type="text" 
                      value={ggufModelName} 
                      onChange={(e) => setGgufModelName(e.target.value)} 
                      placeholder="e.g. custom-llama3"
                      className="project-selector" 
                      style={{ width: '100%', boxSizing: 'border-box' }}
                      required
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.95rem', color: 'var(--text-dim)', display: 'block', marginBottom: '5px' }}>
                      SYSTEM PROMPT / PERSONA (OPTIONAL)
                    </label>
                    <textarea 
                      value={ggufSystemPrompt} 
                      onChange={(e) => setGgufSystemPrompt(e.target.value)} 
                      placeholder="Enter system prompt directives for this custom model..."
                      className="project-selector" 
                      style={{ 
                        width: '100%', 
                        height: '80px', 
                        resize: 'vertical', 
                        boxSizing: 'border-box',
                        fontFamily: 'monospace',
                        fontSize: '0.95rem' 
                      }}
                    />
                  </div>

                  <button 
                    type="submit" 
                    className="new-chat-btn" 
                    disabled={isImporting}
                    style={{ width: '100%', justifyContent: 'center', marginTop: '10px' }}
                  >
                    {isImporting ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="spinner"></span> Importing & Registering...
                      </span>
                    ) : 'Import & Register'}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {currentView === 'train' && (
          <div className="settings-page" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
              <h2 style={{ color: 'var(--accent-red)' }}>Model Fine-Tuning</h2>
              <button className="retro-btn" onClick={(e) => { e.stopPropagation(); setCurrentView('chat'); }} style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }}>◀ BACK TO WORKSPACE</button>
            </div>

            {datasets.length === 0 ? (
              <div className="retro-card" style={{ padding: '40px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px' }}>
                <span style={{ fontSize: '3rem' }}>📁</span>
                <span style={{ fontSize: '1.5rem', color: 'var(--text-dim)' }}>Upload a dataset in the Datasets tab to begin fine-tuning.</span>
                <button className="retro-btn" onClick={() => setCurrentView('datasets')}>GO TO DATASETS</button>
              </div>
            ) : (
              <div className="custom-grid">
                <div className="retro-card">
                  <div className="card-title">Start Fine-Tuning</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
                    <div>
                      <label style={{ fontSize: '1rem', color: 'var(--text-dim)' }}>Base Model</label>
                      <input type="text" value={trainConfig.model_base} onChange={(e) => setTrainConfig({...trainConfig, model_base: e.target.value})} className="project-selector" style={{ width: '100%', boxSizing: 'border-box' }} />
                    </div>
                    
                    <div>
                      <label style={{ fontSize: '1rem', color: 'var(--text-dim)' }}>Dataset</label>
                      <select value={trainConfig.dataset_id} onChange={(e) => setTrainConfig({...trainConfig, dataset_id: e.target.value})} className="project-selector" style={{ width: '100%' }}>
                        {datasets.map(d => <option key={d.id} value={d.id}>{d.name} ({d.status})</option>)}
                      </select>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ fontSize: '1rem', color: 'var(--text-dim)' }}>Epochs</label>
                        <input type="number" min="1" max="100" value={trainConfig.epochs} onChange={(e) => setTrainConfig({...trainConfig, epochs: e.target.value})} className="project-selector" style={{ width: '100%', boxSizing: 'border-box' }} />
                      </div>
                      <div>
                        <label style={{ fontSize: '1rem', color: 'var(--text-dim)' }}>Learning Rate</label>
                        <input type="number" step="0.00001" min="0.00001" max="0.1" value={trainConfig.lr} onChange={(e) => setTrainConfig({...trainConfig, lr: e.target.value})} className="project-selector" style={{ width: '100%', boxSizing: 'border-box' }} />
                      </div>
                    </div>
                    
                    <button className="new-chat-btn" onClick={triggerTrainingJob} style={{ marginTop: '15px' }}>
                      🚀 Start Fine-Tuning
                    </button>
                  </div>
                </div>

                <div className="retro-card">
                  <div className="card-title">Training Progress</div>
                  <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                    {trainingJobs.length === 0 ? (
                      <div style={{ color: 'var(--text-dim)', padding: '10px' }}>No training runs started yet.</div>
                    ) : (
                      trainingJobs.map(j => (
                        <div key={j.id} style={{ borderBottom: '1px solid var(--panel-border)', padding: '10px 0' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem' }}>
                            <span style={{ fontWeight: 'bold' }}>ID: {j.id} // {j.model}</span>
                            <span style={{ color: j.status === 'COMPLETED' ? 'var(--terminal-green)' : 'var(--terminal-amber)' }}>[{j.status}]</span>
                          </div>
                          <div style={{ fontSize: '0.95rem', color: 'var(--text-dim)', display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '6px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span>Progress: {j.progress}%</span>
                              <span>Loss: {j.loss}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span>Epoch: {j.epoch}</span>
                              <span>LR: {j.learning_rate}</span>
                            </div>
                          </div>
                          <div className="progress-bg" style={{ marginBottom: '8px' }}>
                            <div className={`progress-fill ${j.status === 'COMPLETED' ? 'green' : ''}`} style={{ width: `${j.progress}%` }}></div>
                          </div>

                          {j.loss_history && j.loss_history.length > 0 && (
                            <div className="loss-log-box">
                              <div style={{ color: 'var(--text-dim)', borderBottom: '1px solid var(--panel-border)', paddingBottom: '2px', marginBottom: '4px' }}>// Loss Log</div>
                              {j.loss_history.map((lh, idx) => (
                                <div key={idx}>
                                  [Step {(idx+1).toString().padStart(2, '0')}] Loss: {lh.toFixed(4)} | LR: {(j.learning_rate * (1 - idx/15)).toFixed(6)} | Status: Training
                                </div>
                              ))}
                              {j.status === 'COMPLETED' && <div style={{ color: 'var(--terminal-green)', marginTop: '4px' }}>Training completed successfully.</div>}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {currentView === 'datasets' && (
          <div className="settings-page" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
              <h2 style={{ color: 'var(--accent-red)' }}>Dataset Manager</h2>
              <button className="retro-btn" onClick={(e) => { e.stopPropagation(); setCurrentView('chat'); }} style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }}>◀ BACK TO WORKSPACE</button>
            </div>
            
            <div className="custom-grid">
              <div className="retro-card">
                <div className="card-title">Upload Dataset (.CSV, .JSONL)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '15px', alignItems: 'center', justifyContent: 'center', border: '2px dashed var(--panel-border)', padding: '25px', backgroundColor: '#030407' }}>
                  <span style={{ fontSize: '2.5rem' }}>📁</span>
                  <span style={{ color: 'var(--text-dim)' }}>Drag file here, or select below</span>
                  <input 
                    type="file" 
                    ref={datasetFileInputRef} 
                    onChange={handleDatasetFileUpload} 
                    style={{ display: 'none' }}
                    accept=".csv,.jsonl,.json"
                  />
                  <button 
                    className="retro-btn" 
                    onClick={() => datasetFileInputRef.current?.click()} 
                    disabled={isUploadingDataset}
                    style={{ borderColor: 'var(--terminal-green)', color: 'var(--terminal-green)' }}
                  >
                    {isUploadingDataset ? 'Uploading...' : 'Upload File'}
                  </button>
                </div>
              </div>

              <div className="retro-card">
                <div className="card-title">Staged Datasets</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
                  {datasets.length === 0 ? (
                    <div style={{ color: 'var(--text-dim)', padding: '10px' }}>No datasets found. Please upload one.</div>
                  ) : (
                    datasets.map(d => (
                      <div key={d.id} 
                           className={`project-nav-item ${selectedDatasetId === d.id ? 'active' : ''}`} 
                           onClick={() => setSelectedDatasetId(d.id)}
                           style={{ display: 'block', padding: '10px' }}>
                         <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                           <span>📁 {d.name} ({d.size})</span>
                           <span style={{ color: d.status === 'VALIDATED' ? 'var(--terminal-green)' : (d.status === 'VALIDATING' ? 'var(--terminal-amber)' : 'var(--text-dim)') }}>
                             [{d.status}]
                           </span>
                         </div>
                         <div style={{ fontSize: '0.95rem', color: 'var(--text-dim)', marginTop: '4px' }}>
                           Parsed Rows: {d.rows.toLocaleString()} lines | ID: {d.id}
                         </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {selectedDatasetId && (
              <div className="retro-card" style={{ marginTop: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="card-title" style={{ color: 'var(--terminal-green)' }}>// Inspect Dataset: {datasets.find(d => d.id === selectedDatasetId)?.name}</div>
                  <button className="retro-btn" 
                          disabled={isValidatingDataset || datasets.find(d => d.id === selectedDatasetId)?.status === 'VALIDATED'}
                          onClick={() => triggerDatasetValidate(selectedDatasetId)} 
                          style={{ borderColor: 'var(--terminal-green)', color: 'var(--terminal-green)', fontSize: '1.1rem' }}>
                    {datasets.find(d => d.id === selectedDatasetId)?.status === 'VALIDATED' ? 'Validated' : 'Process & Validate'}
                  </button>
                </div>

                <div className="terminal-console">
                  {datasetVectors.length === 0 ? (
                    <div>Loading records...</div>
                  ) : (
                    datasetVectors.map((vl, idx) => (
                      <div key={idx} style={{ color: 'var(--terminal-green)' }}>{vl}</div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {currentView === 'docker' && (
          <div className="settings-page" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
              <h2 style={{ color: 'var(--accent-red)' }}>System Services</h2>
              <button className="retro-btn" onClick={(e) => { e.stopPropagation(); setCurrentView('chat'); }} style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }}>◀ BACK TO WORKSPACE</button>
            </div>
            
            <div className="retro-card" style={{ maxWidth: '950px' }}>
              <div className="card-title">Running Services</div>
              
              <table style={{ width: '100%', textAlign: 'left', fontSize: '1.2rem', marginTop: '15px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--text-dim)', borderBottom: '2px solid var(--panel-border)' }}>
                    <th style={{ padding: '10px' }}>Service Name</th>
                    <th style={{ padding: '10px' }}>Image</th>
                    <th style={{ padding: '10px' }}>Ports</th>
                    <th style={{ padding: '10px' }}>CPU</th>
                    <th style={{ padding: '10px' }}>Status</th>
                    <th style={{ padding: '10px', textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {systemServices.map(c => (
                    <tr key={c.id} style={{ borderBottom: '1px solid var(--panel-border)', backgroundColor: c.status === 'RUNNING' ? 'transparent' : 'rgba(255, 0, 85, 0.03)' }}>
                      <td style={{ padding: '10px', fontWeight: 'bold' }}>{c.id}</td>
                      <td style={{ padding: '10px', color: 'var(--text-dim)' }}>{c.image}</td>
                      <td style={{ padding: '10px' }}>{c.ports}</td>
                      <td style={{ padding: '10px', color: c.status === 'RUNNING' ? 'var(--terminal-green)' : 'var(--text-dim)' }}>{c.cpu}</td>
                      <td style={{ padding: '10px', color: c.status === 'RUNNING' ? 'var(--terminal-green)' : 'var(--accent-red)', fontWeight: 'bold' }}>
                        [{c.status}]
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center' }}>
                        <button className="retro-btn" 
                                onClick={() => toggleDockerContainer(c.id)} 
                                style={{ margin: '0 auto', fontSize: '1rem', borderColor: c.status === 'RUNNING' ? 'var(--accent-red)' : 'var(--terminal-green)', color: c.status === 'RUNNING' ? 'var(--accent-red)' : 'var(--terminal-green)' }}>
                          {c.status === 'RUNNING' ? 'Stop' : 'Start'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {currentView === 'chat' && (
          <>
            <div className="chat-feed">
              {currentMessages.length === 0 ? (
                <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: 'var(--text-dim)' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '10px', textShadow: '0 0 10px rgba(57,255,20,0.3)', color: 'var(--terminal-green)' }}>System Ready</div>
                  <div style={{ letterSpacing: '1px', textTransform: 'uppercase' }}>Awaiting input for {activeProject ? activeProject.name : 'workspace'}...</div>
                </div>
              ) : (
                currentMessages.map((msg, index) => (
                  <div key={index} 
                       className={`message-bubble ${msg.role} ${msg.role === 'assistant' ? getModelBubbleClass(msg.model) : ''}`}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px', fontWeight: 'bold' }}>
                      <span style={{ color: msg.role === 'user' ? 'var(--text-dim)' : 'var(--terminal-green)' }}>
                        {msg.role === 'user' ? '[User]' : (msg.role === 'system' ? '[System]' : `[Model: ${msg.model.toUpperCase()}]`)}
                      </span>
                      {msg.role === 'assistant' && (
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                          via {msg.provider.toUpperCase()}
                        </span>
                      )}
                    </div>
                    {msg.content ? parseTerminalText(msg.content) : '▉'}
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Floating Mentions List dropdown */}
            {showMentionList && getFilteredMentions().length > 0 && (
              <div className="mention-dropdown">
                {getFilteredMentions().map((m, idx) => {
                  const friendlyName = getModelFriendlyName(m);
                  return (
                    <div key={idx} 
                         className={`mention-item ${idx === selectedMentionIndex ? 'selected' : ''}`}
                         onClick={() => insertMention(m)}
                         style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start', padding: '8px 12px' }}>
                      <span style={{ fontWeight: 'bold', fontSize: '1.15rem' }}>@{friendlyName}</span>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>{m.id} ({m.provider.toUpperCase()})</span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="input-area" style={{ flexDirection: 'column', gap: '10px' }}>
              {attachedFiles.length > 0 && (
                <div style={{ display: 'flex', gap: '10px', width: '100%', overflowX: 'auto', paddingBottom: '5px' }}>
                  {attachedFiles.map((f, i) => (
                    <div key={i} style={{ position: 'relative', border: '1px solid var(--terminal-green)', padding: '5px', backgroundColor: 'var(--bg-dark-blue)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {f.type === 'image' ? (
                        <img src={f.url} alt="attached" style={{ height: '40px', maxWidth: '80px', objectFit: 'contain' }} />
                      ) : (
                        <div style={{ fontSize: '24px' }}>📄</div>
                      )}
                      <div style={{ fontSize: '0.8rem', maxWidth: '100px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{f.name}</div>
                      <button 
                        style={{ position: 'absolute', top: '-5px', right: '-5px', background: 'var(--accent-red)', color: 'white', border: 'none', borderRadius: '50%', width: '18px', height: '18px', fontSize: '10px', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                        onClick={() => setAttachedFiles(prev => prev.filter((_, idx) => idx !== i))}
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="input-box" style={{ width: '100%' }}>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  style={{ display: 'none' }} 
                  onChange={handleFileAttachment} 
                  accept=".txt,.csv,.json,.py,.js,.html,.css,.md,image/*"
                />
                <div className="input-icons">
                  <span style={{ cursor: 'pointer', color: 'var(--terminal-green)' }} onClick={() => fileInputRef.current?.click()} title="Add file">📎</span>
                  <div className="directory-indicator" onClick={handleSetDirectory} title={`Active Directory: ${activeDir}. Click to change.`}>
                    DIR
                  </div>
                </div>
                <input 
                  type="text" 
                  placeholder="Type a message... (Use @ to mention specific models)" 
                  value={input} 
                  onChange={(e) => handleInputChange(e.target.value)} 
                  onKeyDown={(e) => {
                    if (showMentionList && getFilteredMentions().length > 0) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setSelectedMentionIndex(prev => (prev + 1) % getFilteredMentions().length);
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setSelectedMentionIndex(prev => (prev - 1 + getFilteredMentions().length) % getFilteredMentions().length);
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        insertMention(getFilteredMentions()[selectedMentionIndex]);
                      }
                    } else if (e.key === 'Enter') {
                      handleSendMessage();
                    }
                  }} 
                  disabled={isGenerating} 
                />
                <button className="send-btn" onClick={handleSendMessage} disabled={isGenerating}>{'>'}</button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* --- BUFFER MANAGER MODAL --- */}
      {showBufferManager && (
        <div className="modal-overlay" onClick={() => setShowBufferManager(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '500px', maxWidth: '90%' }}>
            <h2 style={{ marginTop: 0, color: 'var(--accent-red)' }}>Manage Context Buffer</h2>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginBottom: '20px' }}>
              Selectively remove ingested files from the AI's active workspace memory.
            </p>
            <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--panel-border)', backgroundColor: 'var(--panel-bg)', borderRadius: '4px', padding: '10px' }}>
              {currentMessages.filter(m => m.role === 'system' && m.content.startsWith('[SYS_INDEXER]: Attached file')).length === 0 ? (
                <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '20px' }}>Buffer is clear.</div>
              ) : (
                currentMessages.map((m, idx) => {
                  if (m.role === 'system' && m.content.startsWith('[SYS_INDEXER]: Attached file')) {
                    const match = m.content.match(/Attached file "(.*?)" \(([0-9]+) bytes, ([0-9]+) lines\)/);
                    if (match) {
                      const name = match[1];
                      const bytes = parseInt(match[2]);
                      const lines = parseInt(match[3]);
                      return (
                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', borderBottom: '1px solid var(--panel-border)' }}>
                          <div>
                            <strong style={{ color: 'var(--terminal-green)' }}>{name}</strong>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{bytes} bytes | {lines} lines</div>
                          </div>
                          <button className="retro-btn" onClick={() => {
                            const updatedMsg = currentMessages.filter((_, msgIdx) => msgIdx !== idx);
                            const newFilesIndexed = Math.max(0, activeProject.filesIndexed - 1);
                            const newContextLines = Math.max(0, activeProject.contextLines - lines);
                            const newTokenUsage = Math.max(0, activeProject.tokenUsage - bytes);
                            setProjects(prev => prev.map(p => p.id === activeProjectId ? { ...p, filesIndexed: newFilesIndexed, contextLines: newContextLines, tokenUsage: newTokenUsage, messages: updatedMsg } : p));
                            syncProjectMessages(activeProjectId, updatedMsg, newTokenUsage, newFilesIndexed, newContextLines, activeProject.bufferLimitMb);
                          }} style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)', fontSize: '0.8rem', padding: '2px 8px' }}>
                            REMOVE
                          </button>
                        </div>
                      );
                    }
                  }
                  return null;
                })
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button className="retro-btn" onClick={() => setShowBufferManager(false)}>DONE</button>
            </div>
          </div>
        </div>
      )}

      {/* 3. RIGHT SIDEBAR */}
      {rightOpen && currentView === 'chat' && (
        <div className="right-sidebar" onClick={(e) => e.stopPropagation()}>
          <div className="right-tabs">
            <div className={`right-tab ${activeRightTab === 'context' ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); setActiveRightTab('context'); }}>WORKSPACE</div>
            <div className={`right-tab ${activeRightTab === 'params' ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); setActiveRightTab('params'); }}>SETTINGS</div>
          </div>

          <div className="right-content">
            {activeRightTab === 'context' ? (
              <>
                <div>
                  <div className="card-title">Workspace Info</div>
                  <div className="retro-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                      <span style={{ color: 'var(--terminal-amber)' }}>📁</span>
                      <span style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{activeProject ? activeProject.name : 'Workspace'}</span>
                    </div>
                    <div style={{ fontSize: '0.95rem', color: 'var(--text-dim)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ wordBreak: 'break-all' }}>
                        <strong>Active Dir:</strong> {activeDir || 'None (Clear)'}
                      </div>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button className="retro-btn" onClick={(e) => { e.stopPropagation(); handleSetDirectory(); }} style={{ fontSize: '0.8rem', padding: '2px 8px' }}>
                          SET PATH
                        </button>
                        <button className="retro-btn" onClick={(e) => { e.stopPropagation(); document.getElementById('context-file-upload').click(); }} style={{ fontSize: '0.8rem', padding: '2px 8px' }}>
                          + ADD FILE TO CONTEXT
                        </button>
                        <input type="file" id="context-file-upload" style={{ display: 'none' }} onChange={(e) => {
                          const file = e.target.files[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            const textContent = event.target.result || "";
                            const lineCount = textContent.split('\n').length;
                            const fileSize = file.size;
                            const systemMsg = {
                              role: 'system',
                              content: `[SYS_INDEXER]: Attached file "${file.name}" (${fileSize} bytes, ${lineCount} lines) mounted. Context index vector compiled into current chat session memory.`
                            };
                            const targetProj = projects.find(p => p.id === activeProjectId);
                            if (targetProj) {
                              const updatedMsg = [...targetProj.messages, systemMsg];
                              const newFilesIndexed = targetProj.filesIndexed + 1;
                              const newContextLines = targetProj.contextLines + lineCount;
                              const newTokenUsage = Math.min((activeBufferLimitMb * 1024 * 1024), targetProj.tokenUsage + fileSize);
                              setProjects(prev => prev.map(p => p.id === activeProjectId ? { ...p, filesIndexed: newFilesIndexed, contextLines: newContextLines, tokenUsage: newTokenUsage, messages: updatedMsg } : p));
                              syncProjectMessages(activeProjectId, updatedMsg, newTokenUsage, newFilesIndexed, newContextLines);
                            }
                            alert(`SUCCESS: Added "${file.name}" to context buffer.`);
                          };
                          reader.readAsText(file);
                        }} />
                      </div>
                      <div style={{ marginTop: '5px' }}>Files Indexed: {activeProject ? activeProject.filesIndexed : 0} files</div>
                      <div>Reference Metrics: {activeProject ? activeProject.contextLines : 0} reference lines</div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="card-title">Buffer Usage</div>
                  <div className="retro-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem' }}>
                      <span>{((activeProject && activeProject.tokenUsage) || 0).toLocaleString()} / {(activeBufferLimitMb * 1024 * 1024).toLocaleString()} bytes</span>
                      <span style={{ color: 'var(--accent-red)' }}>{Math.min(100, Math.round((((activeProject && activeProject.tokenUsage) || 0) / (activeBufferLimitMb * 1024 * 1024)) * 100))}%</span>
                    </div>
                    <div className="progress-bg">
                      <div className="progress-fill" style={{ width: `${Math.min(100, (((activeProject && activeProject.tokenUsage) || 0) / (activeBufferLimitMb * 1024 * 1024)) * 100)}%` }}></div>
                    </div>
                    
                    <div style={{ marginTop: '15px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      <label style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>Workspace Buffer Limit (MB):</label>
                      <input 
                        type="number" 
                        min="1"
                        max="1024"
                        value={activeBufferLimitMb} 
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          if (val > 0) {
                            setProjects(prev => prev.map(p => p.id === activeProjectId ? { ...p, bufferLimitMb: val } : p));
                            syncProjectMessages(activeProjectId, currentMessages, activeProject.tokenUsage, activeProject.filesIndexed, activeProject.contextLines, val);
                          }
                        }} 
                        style={{ 
                          width: '100%', 
                          boxSizing: 'border-box',
                          backgroundColor: 'var(--bg-color)',
                          color: 'var(--text-light)',
                          border: '1px solid var(--panel-border)',
                          padding: '6px 10px',
                          borderRadius: '4px',
                          fontFamily: 'monospace'
                        }} 
                      />
                    </div>
                    <button className="retro-btn" onClick={(e) => { e.stopPropagation(); setShowBufferManager(true); }} style={{ marginTop: '15px', width: '100%', fontSize: '0.9rem' }}>
                      MANAGE BUFFER CONTENT
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div>
                <div className="card-title">Workspace Features</div>
                <div className="retro-card" style={{ marginBottom: '15px' }}>
                  <div className="toggle-row">
                    <span>Include Workspace Files</span>
                    <div className={`toggle-switch ${toggles.context ? 'on' : ''}`} onClick={() => handleToggle('context')}></div>
                  </div>
                  
                  <div className="toggle-row">
                    <span>Auto-Save Logs</span>
                    <div className={`toggle-switch ${toggles.autoSave ? 'on' : ''}`} onClick={() => handleToggle('autoSave')}></div>
                  </div>
                </div>

                <div className="card-title">Multi-Agent Chat</div>
                <div className="retro-card" style={{ marginBottom: '15px' }}>
                  <div style={{ fontSize: '0.95rem', color: 'var(--text-dim)', marginBottom: '10px', lineHeight: '1.4' }}>
                    {selectedParallelModels.length > 0
                      ? `${selectedParallelModels.length} model${selectedParallelModels.length !== 1 ? 's' : ''} will respond to each message.`
                      : 'Single model mode. Configure responders to get replies from multiple models.'}
                  </div>
                  {selectedParallelModels.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '10px' }}>
                      {selectedParallelModels.map((name, i) => {
                        const m = visibleAvailableModels.find(v => v.name === name);
                        return m ? (
                          <span key={i} style={{ fontSize: '0.85rem', padding: '2px 8px', border: '1px solid var(--terminal-green)', color: 'var(--terminal-green)', backgroundColor: 'rgba(57,255,20,0.05)' }}>
                            {getModelFriendlyName(m)}
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}
                  <button
                    className="retro-btn"
                    onClick={(e) => { e.stopPropagation(); setCurrentView('multi-agent'); }}
                    style={{ width: '100%', justifyContent: 'center', borderColor: 'var(--terminal-amber)', color: 'var(--terminal-amber)', fontSize: '1rem' }}
                  >
                    ⚡ Configure Responders
                  </button>
                </div>

                <div className="card-title">Model Settings</div>
                <div className="retro-card" style={{ marginBottom: '15px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem' }}>
                      <span>Temperature</span>
                      <span style={{ color: 'var(--terminal-green)', fontWeight: 'bold' }}>{temperature.toFixed(1)}</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.0" 
                      max="1.2" 
                      step="0.1" 
                      value={temperature} 
                      onChange={(e) => setTemperature(parseFloat(e.target.value))} 
                      style={{ width: '100%', accentColor: 'var(--accent-red)', cursor: 'pointer' }}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem' }}>
                      <span>Max Tokens</span>
                      <span style={{ color: 'var(--terminal-green)', fontWeight: 'bold' }}>{maxTokens}</span>
                    </div>
                    <select 
                      value={maxTokens} 
                      onChange={(e) => setMaxTokens(parseInt(e.target.value) || 4096)} 
                      className="project-selector" 
                      style={{ width: '100%', padding: '4px' }}
                    >
                      <option value={256}>256 (Short)</option>
                      <option value={512}>512 (Medium)</option>
                      <option value={1024}>1024 (Standard)</option>
                      <option value={2048}>2048 (High)</option>
                      <option value={4096}>4096 (Large)</option>
                      <option value={8192}>8192 (Max)</option>
                    </select>
                  </div>
                </div>

                <div className="card-title">System Prompt Override</div>
                <div className="retro-card" style={{ padding: '8px', backgroundColor: '#000000', border: '1px solid var(--panel-border)' }}>
                  <textarea 
                    value={systemPrompt} 
                    onChange={(e) => setSystemPrompt(e.target.value)} 
                    className="project-selector" 
                    style={{ 
                      width: '100%', 
                      height: '80px', 
                      fontFamily: 'monospace', 
                      fontSize: '0.95rem', 
                      resize: 'vertical',
                      boxSizing: 'border-box',
                      backgroundColor: '#000000',
                      border: 'none',
                      color: 'var(--text-light)',
                      outline: 'none'
                    }}
                    placeholder="Enter custom prompt directives..."
                  />
                </div>

                <div className="card-title" style={{ marginTop: '15px' }}>Personalities</div>
                <div className="retro-card" style={{ padding: '10px', marginBottom: '0' }}>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-dim)', marginBottom: '8px' }}>
                    Set custom personality prompts for each model in the multi-agent config.
                  </div>
                  <button
                    className="retro-btn"
                    onClick={(e) => { e.stopPropagation(); setCurrentView('multi-agent'); }}
                    style={{ width: '100%', justifyContent: 'center', fontSize: '0.95rem', borderColor: 'var(--terminal-amber)', color: 'var(--terminal-amber)' }}
                  >
                    Open Responder Config →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      {promptModal.visible && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 10000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div className="retro-card" style={{ width: '400px', backgroundColor: 'var(--panel-blue)', border: '2px solid var(--terminal-green)', padding: '20px' }}>
            <h3 style={{ color: 'var(--terminal-green)', marginTop: 0 }}>{promptModal.title}</h3>
            <input 
              type="text" 
              value={promptModal.value} 
              onChange={(e) => setPromptModal(prev => ({ ...prev, value: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') handlePromptSubmit(); if (e.key === 'Escape') setPromptModal(prev => ({ ...prev, visible: false })); }}
              className="project-selector" 
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: '15px' }} 
              autoFocus
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button className="retro-btn" onClick={() => setPromptModal(prev => ({ ...prev, visible: false }))}>CANCEL</button>
              <button className="retro-btn" style={{ borderColor: 'var(--terminal-green)', color: 'var(--terminal-green)' }} onClick={handlePromptSubmit}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;