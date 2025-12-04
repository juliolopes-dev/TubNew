const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;

// Caminho para o yt-dlp
function getYtDlpPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', 'yt-dlp.exe');
  }
  return path.join(__dirname, '..', 'bin', 'yt-dlp.exe');
}

// Caminho para o ffmpeg
function getFfmpegPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin');
  }
  return path.join(__dirname, '..', 'bin');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    transparent: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.ico')
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  
  // Abrir DevTools em desenvolvimento
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Controles da janela
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});
ipcMain.on('window-close', () => mainWindow.close());

// Selecionar pasta de download
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths[0] || null;
});

// Abrir pasta
ipcMain.handle('open-folder', async (event, folderPath) => {
  shell.openPath(folderPath);
});

// Obter informações do vídeo
ipcMain.handle('get-video-info', async (event, url) => {
  return new Promise((resolve, reject) => {
    const ytDlpPath = getYtDlpPath();
    
    const args = [
      '--dump-json',
      '--no-playlist',
      url
    ];

    const process = spawn(ytDlpPath, args);
    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      if (code === 0) {
        try {
          const info = JSON.parse(stdout);
          resolve({
            success: true,
            data: {
              title: info.title,
              thumbnail: info.thumbnail,
              duration: info.duration,
              uploader: info.uploader,
              view_count: info.view_count,
              formats: info.formats
            }
          });
        } catch (e) {
          reject({ success: false, error: 'Erro ao processar informações do vídeo' });
        }
      } else {
        reject({ success: false, error: stderr || 'Erro ao obter informações do vídeo' });
      }
    });
  });
});

// Baixar vídeo
ipcMain.handle('download-video', async (event, { url, outputPath, format, quality }) => {
  return new Promise((resolve, reject) => {
    const ytDlpPath = getYtDlpPath();
    const ffmpegPath = getFfmpegPath();
    
    // Detectar tipo de URL
    const isInstagram = url.includes('instagram.com');
    const isShorts = url.includes('/shorts/');
    
    let args;
    if (format === 'mp3') {
      args = [
        '-x', '--audio-format', 'mp3', '--audio-quality', '0',
        '--ffmpeg-location', ffmpegPath,
        '-o', path.join(outputPath, '%(title)s.%(ext)s'),
        '--no-playlist',
        '--newline',
        '--progress',
        url
      ];
    } else {
      // Baixar formato já combinado (single file) quando possível
      let formatStr;
      if (quality === 'best') {
        formatStr = 'best[ext=mp4]/best';
      } else if (quality === '1080') {
        formatStr = 'best[height<=1080][ext=mp4]/best[height<=1080]';
      } else if (quality === '720') {
        formatStr = 'best[height<=720][ext=mp4]/best[height<=720]';
      } else if (quality === '480') {
        formatStr = 'best[height<=480][ext=mp4]/best[height<=480]';
      } else {
        formatStr = 'best[height<=360][ext=mp4]/best[height<=360]';
      }
      
      args = [
        '-f', formatStr,
        '--ffmpeg-location', ffmpegPath,
        '-o', path.join(outputPath, '%(title)s.%(ext)s'),
        '--no-playlist',
        '--newline',
        '--progress',
        url
      ];
    }

    const downloadProcess = spawn(ytDlpPath, args);
    let lastProgress = 0;

    downloadProcess.stdout.on('data', (data) => {
      const output = data.toString();
      
      // Extrair progresso
      const progressMatch = output.match(/(\d+\.?\d*)%/);
      if (progressMatch) {
        const progress = parseFloat(progressMatch[1]);
        if (progress !== lastProgress) {
          lastProgress = progress;
          mainWindow.webContents.send('download-progress', { progress });
        }
      }
    });

    downloadProcess.stderr.on('data', (data) => {
      console.error('stderr:', data.toString());
    });

    downloadProcess.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        reject({ success: false, error: 'Erro durante o download' });
      }
    });

    downloadProcess.on('error', (err) => {
      reject({ success: false, error: err.message });
    });
  });
});

// Obter pasta padrão de downloads
ipcMain.handle('get-default-download-path', () => {
  return app.getPath('downloads');
});
