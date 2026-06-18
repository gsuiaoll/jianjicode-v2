const { detectBestHardwareAcceleration } = require('./electron/export/ffmpeg-utils.js');

console.log('Testing LTX hardware acceleration detection...');
const result = detectBestHardwareAcceleration();
console.log('Result:', result);
console.log(`HWAccel: ${result.hwaccel || 'none'}, Encoder: ${result.encoder || 'none'}`);

if (result.hwaccel) {
  console.log('✅ Hardware acceleration detected');
} else {
  console.log('❌ No hardware acceleration detected');
}

if (result.encoder) {
  console.log('✅ Hardware encoder detected:', result.encoder);
} else {
  console.log('❌ No hardware encoder detected');
}
