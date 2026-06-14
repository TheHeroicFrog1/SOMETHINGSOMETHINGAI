<div align="center">
  <img src="build/icon.png" alt="Bifrost Logo" width="200" />
  <h1>Bifrost AI</h1>
  <p>A powerful, cross-platform AI desktop interface with a local Python processing engine.</p>
  
  <a href="https://github.com/TheHeroicFrog1/Bifrost/releases/latest">
    <img src="https://img.shields.io/github/v/release/TheHeroicFrog1/Bifrost?color=blue&label=Latest%20Release" alt="Release">
  </a>
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platforms">
  <img src="https://img.shields.io/badge/Stack-Electron%20%7C%20Python%20%7C%20React-blueviolet" alt="Stack">
</div>

<hr />

<div align="center">
  <video src="https://raw.githubusercontent.com/TheHeroicFrog1/Bifrost/main/build/demo.mp4" controls muted width="800"></video>
</div>

<h2>⚡ About Bifrost</h2>
<p>Bifrost bridges the gap between powerful Python-based AI engines and a beautiful, fast desktop user interface. It runs as a unified application: the Electron UI handles the experience, while an embedded, compiled FastAPI/Python engine handles the heavy lifting in the background.</p>

<h2>✨ Key Features</h2>
<ul>
  <li><strong>🔒 Absolute Privacy:</strong> Your data never leaves your machine. The embedded AI engine processes everything 100% locally, ensuring complete data security and offline capabilities.</li>
  <li><strong>🎭 Multiple Models & Personalities:</strong> Seamlessly switch between different AI models on the fly. Create and save unique personas, system prompts, and roles tailored to specific workflows.</li>
  <li><strong>🧠 Train & Customize:</strong> Take control of your AI's knowledge. Train and fine-tune models on your own specific data to create a truly personalized desktop assistant.</li>
</ul>

<h2>🚀 Download & Install</h2>
<p>Head over to the <a href="https://github.com/TheHeroicFrog1/Bifrost/releases/latest">Releases Page</a> to download the latest version for your system.</p>
<ul>
  <li><strong>Windows:</strong> Download the <code>.exe</code> installer.</li>
  <li><strong>macOS:</strong> Download the <code>.dmg</code> file.</li>
  <li><strong>Linux:</strong> Download the <code>.AppImage</code> or <code>.deb</code> file.</li>
</ul>

<blockquote>
  <p><strong>⚠️ Note for Windows Users:</strong> Because this is an independently developed open-source tool, Microsoft has not yet verified the publisher certificate. If you see a <strong>"Windows protected your PC"</strong> SmartScreen warning during installation, click <strong>"More info"</strong> and then <strong>"Run anyway"</strong>.</p>
</blockquote>

<h3>💻 Command Line Installation (For Power Users)</h3>

<p><strong>Windows (PowerShell)</strong><br>
Run this command as Administrator to download and launch the latest installer:</p>
<pre><code class="language-powershell">Invoke-WebRequest -Uri "https://github.com/TheHeroicFrog1/Bifrost/releases/latest/download/Bifrost-Setup-1.0.0.exe" -OutFile "$env:TEMP\Bifrost-Setup-1.0.0.exe"; Start-Process "$env:TEMP\Bifrost-Setup-1.0.0.exe"</code></pre>

<p><strong>macOS (Terminal)</strong><br>
Download the DMG to your downloads folder and mount it:</p>
<pre><code class="language-bash">curl -L -o ~/Downloads/Bifrost.dmg https://github.com/TheHeroicFrog1/Bifrost/releases/latest/download/Bifrost-1.0.0-arm64.dmg && open ~/Downloads/Bifrost.dmg</code></pre>

<p><strong>Linux (Terminal)</strong><br>
Download the AppImage, make it executable, and launch it:</p>
<pre><code class="language-bash">wget https://github.com/TheHeroicFrog1/Bifrost/releases/latest/download/Bifrost-1.0.0.AppImage -O ~/Bifrost.AppImage && chmod +x ~/Bifrost.AppImage && ~/Bifrost.AppImage</code></pre>

<h2>🛠️ Architecture</h2>
<p>Bifrost is built using a decoupled architecture for maximum stability:</p>
<ul>
  <li><strong>Frontend UI:</strong> Electron + React (Vite)</li>
  <li><strong>Backend Engine:</strong> Python + FastAPI (Compiled via PyInstaller)</li>
  <li><strong>Build Pipeline:</strong> GitHub Actions automated CI/CD</li>
</ul>

<h2>💻 Development Setup</h2>
<p>Want to build Bifrost from source or contribute?</p>

<h3>Prerequisites</h3>
<ul>
  <li><a href="https://nodejs.org/">Node.js</a> (v20+)</li>
  <li><a href="https://www.python.org/">Python</a> (v3.10+)</li>
</ul>

<h3>1. Clone and Install</h3>
<pre><code class="language-bash">git clone https://github.com/TheHeroicFrog1/Bifrost.git
cd Bifrost
npm install
pip install -r backend/requirements.txt</code></pre>

