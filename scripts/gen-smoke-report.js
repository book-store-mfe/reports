// gen-smoke-report.js
const fs = require('fs');
const path = require('path');

// Config
const jsonFile = process.argv[2] || 'smoke-results.json';
const outputFile = process.argv[3] || 'SMOKE-REPORT.md';
const videoBaseDir = 'smoke-outputs'; // para onde você move os vídeos (ajuste conforme precisa)
const repoUrl = 'https://github.com/book-store-mfe/store/blob/main/'; // ajuste pro seu repo se quiser link direto no github

// Helper para copiar o vídeo pro smoke-outputs e retornar caminho relativo
function copyAndLinkVideo(absPath) {
  console.log('absPath', absPath, fs.existsSync(absPath));
  if (!fs.existsSync(absPath)) return null;
  const fileName = path.basename(absPath);
  const target = path.join(videoBaseDir, fileName);

  if (!fs.existsSync(videoBaseDir)) fs.mkdirSync(videoBaseDir, { recursive: true });
  // Copia se não existir
  //if (!fs.existsSync(target)) fs.copyFileSync(absPath, target);

  // Retorna caminho relativo (para linkar no markdown)
  return `${videoBaseDir}/${fileName}`;
}

// Carregar o JSON
const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));

let md = `# 🧪 Playwright Smoke Report

**Start:** ${data.stats?.startTime}
**Duration:** ${Math.round(data.stats?.duration)} ms

| Test Suite | Test Case | Status | Video |
|------------|-----------|--------|-------|
`;

for (const suite of data.suites) {
  for (const childSuite of suite.suites || []) {
    for (const spec of childSuite.specs || []) {
      for (const test of spec.tests || []) {
        // Assume primeiro result (não lida com retries múltiplos)
        const result = test.results[0];
        const status = result.status === 'passed' ? '✅ Pass' : result.status === 'failed' ? '❌ Fail' : result.status;
        // Pega attachment de vídeo
        console.log('attachments', result.attachments);
        const videoAttachment = (result.attachments || []).find(a => a.contentType === 'video/webm');
        let videoLink = '';
        if (videoAttachment) {
          const relPath = copyAndLinkVideo(videoAttachment.path);
          console.log('relPath', relPath);
          if (relPath) {
            // Markdown link, ou HTML <video> se quiser inline
            //videoLink = `[🎬 Ver vídeo](${relPath})`;
            //videoLink = `<a href="${relPath}">🎬</a>`;
            // Ou, se quiser player inline localmente:
            // videoLink = `<video src="${relPath}" controls width="200"></video>`;
            // Ou, se quiser link pro repo (exige push dos vídeos):
            videoLink = `[🎬 Ver vídeo no GitHub](${repoUrl}${relPath})`;
          }
        }
        md += `| \`${suite.title}\` | \`${spec.title}\` | ${status} | ${videoLink} |\n`;
      }
    }
  }
}

md += `

---
*Gerado em: ${new Date().toLocaleString()}*
`;

// Escreve o markdown
fs.writeFileSync(outputFile, md, 'utf8');

console.log(`✅ Markdown report salvo em ${outputFile}`);
