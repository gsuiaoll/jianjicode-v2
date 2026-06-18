#!/usr/bin/env node

/**
 * Script to download pre-built FFmpeg binaries for the current platform
 */

import fs from 'fs';
import https from 'https';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PLATFORM_BINARIES = {
  'win32': {
    url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    extractDir: 'ffmpeg-',
    binaryName: 'ffmpeg.exe',
    probeName: 'ffprobe.exe',
    binSubdir: 'bin'
  },
  'darwin': {
    url: 'https://evermeet.cx/ffmpeg/ffmpeg-7.0.zip',
    extractDir: null,
    binaryName: 'ffmpeg',
    probeName: 'ffprobe'
  },
  'linux': {
    url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
    extractDir: 'ffmpeg-',
    binaryName: 'ffmpeg',
    probeName: 'ffprobe'
  }
};

const RESOURCES_DIR = join(__dirname, '..', 'resources', 'ffmpeg');

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

function extractZip(zipPath, destDir) {
  // Use unzip command
  try {
    execSync(`unzip -q "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' });
    return true;
  } catch (e) {
    console.error('Failed to extract zip:', e.message);
    return false;
  }
}

function extractTarXz(tarPath, destDir) {
  try {
    execSync(`tar -xf "${tarPath}" -C "${destDir}"`, { stdio: 'inherit' });
    return true;
  } catch (e) {
    console.error('Failed to extract tar.xz:', e.message);
    return false;
  }
}

async function main() {
  const platform = process.platform;
  const config = PLATFORM_BINARIES[platform];

  if (!config) {
    console.error(`Unsupported platform: ${platform}`);
    process.exit(1);
  }

  console.log(`Downloading FFmpeg for ${platform}...`);

  // Create resources directory
  const platformDir = join(RESOURCES_DIR, platform);
  if (!fs.existsSync(platformDir)) {
    fs.mkdirSync(platformDir, { recursive: true });
  }

  const url = config.url;
  const fileName = url.split('/').pop();
  const downloadPath = join(platformDir, fileName);

  try {
    // Download
    console.log(`Downloading ${url}...`);
    await downloadFile(url, downloadPath);
    console.log('Download completed.');

    // Extract
    console.log('Extracting...');
    let extracted = false;
    if (fileName.endsWith('.zip')) {
      extracted = extractZip(downloadPath, platformDir);
    } else if (fileName.endsWith('.tar.xz')) {
      extracted = extractTarXz(downloadPath, platformDir);
    } else {
      console.error('Unsupported archive format:', fileName);
      process.exit(1);
    }

    if (!extracted) {
      console.error('Extraction failed');
      process.exit(1);
    }

    // Find and copy binaries
    let ffmpegPath, ffprobePath;

    if (config.extractDir) {
      // Look for the extracted directory
      const entries = fs.readdirSync(platformDir);
      const extractDir = entries.find(e => e.includes(config.extractDir.replace('*', '')));
      if (extractDir) {
        const extractPath = join(platformDir, extractDir);
        ffmpegPath = join(extractPath, config.binaryName);
        ffprobePath = join(extractPath, config.probeName);
      }
    } else {
      // Direct binary (macOS)
      ffmpegPath = join(platformDir, config.binaryName);
      ffprobePath = join(platformDir, config.probeName);
    }

    if (ffmpegPath && fs.existsSync(ffmpegPath)) {
      const targetFfmpeg = join(platformDir, config.binaryName);
      fs.copyFileSync(ffmpegPath, targetFfmpeg);
      console.log(`FFmpeg binary copied to: ${targetFfmpeg}`);
    }

    if (ffprobePath && fs.existsSync(ffprobePath)) {
      const targetFfprobe = join(platformDir, config.probeName);
      fs.copyFileSync(ffprobePath, targetFfprobe);
      console.log(`FFprobe binary copied to: ${targetFfprobe}`);
    }

    // Clean up archive
    fs.unlinkSync(downloadPath);
    console.log('Cleanup completed.');

    console.log('\nFFmpeg binaries are now available in:', platformDir);
    console.log('You may need to make them executable on Unix systems:');
    console.log(`  chmod +x "${join(platformDir, config.binaryName)}"`);
    console.log(`  chmod +x "${join(platformDir, config.probeName)}"`);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}