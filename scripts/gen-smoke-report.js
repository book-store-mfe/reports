const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const stripAnsi = require('strip-ansi').default;

// CONFIG
const jsonFile = process.argv[2] || 'smoke-results.json';
const outputFile = process.argv[3] || 'SMOKE-REPORT.md';
const videoBaseDir = 'smoke-outputs';
//const repoRaw = 'https://raw.githubusercontent.com/book-store-mfe/store/main/';
const repoRaw = 'https://github.com/book-store-mfe/reports/raw/refs/heads/main/';

function slugify(str) {
  return str
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function processVideo(videoPath, destName) {
  if (!fs.existsSync(videoPath)) return { video: null, gif: null };
  if (!fs.existsSync(videoBaseDir)) fs.mkdirSync(videoBaseDir, { recursive: true });
  const ext = path.extname(videoPath);
  const baseFile = path.join(videoBaseDir, destName);
  const targetVideo = baseFile + ext;
  const targetGif = baseFile + '.gif';

  if (!fs.existsSync(targetVideo)) fs.copyFileSync(videoPath, targetVideo);

  try {
    const framesDir = baseFile + '_frames';
    if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir);
    execSync(`ffmpeg -y -i "${videoPath}" -vf "fps=7,scale=iw*2:ih*2:flags=lanczos" "${framesDir}/frame_%03d.png"`);
    execSync(`ffmpeg -y -i "${videoPath}" -vf "fps=7,scale=iw*2:ih*2:flags=lanczos,palettegen" "${baseFile}_palette.png"`);
    execSync(`ffmpeg -y -i "${videoPath}" -i "${baseFile}_palette.png" -filter_complex "fps=7,scale=iw*2:ih*2:flags=lanczos[x];[x][1:v]paletteuse=dither=sierra2_4a" "${targetGif}"`);
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.rmSync(baseFile + '_palette.png', { force: true });
  } catch (e) {
    console.error(`Erro convertendo gif: ${videoPath}: ${stripAnsi(e.message)}`);
    return { video: targetVideo, gif: null };
  }
  return { video: targetVideo, gif: targetGif };
}

function pathForMD(p) {
  return p.replace(/\\/g, '/');
}
function anchor(str) {
  return slugify(str);
}

function errorMarkdown(error) {
  if (!error) return '';
  let md = `<details><summary>❌ <b>Erro detalhado</b></summary>\n\n`;
  if (error.message) md += `\n\`\`\`txt\n${stripAnsi(error.message)}\n\`\`\`\n`;
  if (error.stack) md += `\n<details><summary>Stack Trace</summary>\n\n\`\`\`txt\n${stripAnsi(error.stack)}\n\`\`\`\n</details>\n`;
  if (error.snippet) md += `\n<details><summary>Snippet</summary>\n\n\`\`\`ts\n${stripAnsi(error.snippet)}\n\`\`\`\n</details>\n`;
  if (error.location) md += `\n**Arquivo:** \`${error.location.file}\` Linha: \`${error.location.line}\` Col: \`${error.location.column}\`\n`;
  md += `</details>\n`;
  return md;
}

// Coleta todos testes linearmente agrupados por arquivo
function* collectTests(suites, parentFile = null, parentTitles = []) {
  for (const suite of suites) {
    const file = suite.file || parentFile;
    // Para cada describe (suite)
    if (suite.suites) {
      for (const childSuite of suite.suites) {
        const titles = [...parentTitles, childSuite.title].filter(Boolean);
        yield* collectTests([childSuite], file, titles);
      }
    }
    // Para cada spec
    if (suite.specs) {
      for (const spec of suite.specs) {
        for (const test of spec.tests) {
          // Usa o título de describe completo (flattened)
          yield {
            file,
            titles: parentTitles,
            testTitle: spec.title,
            test,
          };
        }
      }
    }
  }
}

// ========== MAIN ==========
const jsonContent = fs.readFileSync(jsonFile, 'utf8');
const data = JSON.parse(jsonContent);

// Agrupa testes por arquivo
const testsByFile = {};
for (const t of collectTests(data.suites)) {
  if (!testsByFile[t.file]) testsByFile[t.file] = [];
  testsByFile[t.file].push(t);
}

// --- GERA ÍNDICE
let md = `# 🧪 Smoke Report

**Início:** ${data.stats?.startTime}  
**Duração:** ${Math.round(data.stats?.duration)} ms  

## Índice
`;

Object.entries(testsByFile).forEach(([file, tests]) => {
  const fileAnchor = anchor(file);
  md += `- [${file}](#${fileAnchor})\n`;
  tests.forEach(t => {
    const testAnchor = anchor(file + '-' + t.testTitle);
    md += `  - [${t.testTitle}](#${testAnchor})\n`;
  });
});
md += `\n---\n`;

Object.entries(testsByFile).forEach(([file, tests]) => {
  const fileAnchor = anchor(file);
  md += `\n# <a name="${fileAnchor}"></a>📄 \`${file}\`\n\n`;

  tests.forEach(t => {
    const result = t.test.results?.[0] || {};
    const statusEmoji = result.status === 'passed' ? '✅' : result.status === 'failed' ? '❌' : '⏺️';
    const testAnchor = anchor(file + '-' + t.testTitle);
    const describeStr = t.titles.length > 0 ? `> ${t.titles.join(' › ')}` : '';

    // VIDEO/GIF
    const videoAtt = (result.attachments || []).find(a => a.contentType === 'video/webm');
    let videoLink = '', gifMd = '';
    const fileName = slugify(file + '-' + t.titles.join('-') + '-' + t.testTitle);
    if (videoAtt && videoAtt.path) {
      const { video, gif } = processVideo(videoAtt.path, fileName);
      if (gif) gifMd = `![GIF demo](${pathForMD(gif)})`;
      if (video) {
        const videoRawUrl = repoRaw + pathForMD(video);
        videoLink = `[🎬 Ver vídeo raw](${videoRawUrl})`;
      }
    }

    md += `\n## <a name="${testAnchor}"></a> ${statusEmoji} **${t.testTitle}**\n`;
    if (describeStr) md += `_${describeStr}_\n\n`;
    if (videoLink) md += `${videoLink}\n\n`;
    if (gifMd) md += `<details><summary>👁️ Ver GIF</summary>\n\n${gifMd}\n\n</details>\n\n`;
    if (result.status === 'failed') {
      md += errorMarkdown(result.error || (result.errors && result.errors[0]));
    }
    md += '\n---\n';
  });
});

md += `\n*Gerado em: ${new Date().toLocaleString()}*\n`;

fs.writeFileSync(outputFile, md, 'utf8');
console.log(`✅ Markdown report salvo em ${outputFile}`);
