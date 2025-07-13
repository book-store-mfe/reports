const fs = require('fs');
const path = require('path');
const semver = require('semver');

// Usage: node validate-remotes.js [output_mode] [local|prod]
// Ex:    node validate-remotes.js terminal prod
const OUTPUT_MODE = process.argv[2] || 'terminal';
const ENV_MODE = (process.argv[3] || 'local').toLowerCase();
const REMOTES_PATH = path.join(__dirname, './remotes.json');

// Utils
function pad(str, len) {
  const real = (str || '').toString();
  return real + ' '.repeat(Math.max(0, len - real.length));
}
function color(str, c) {
  if (OUTPUT_MODE !== 'terminal') return str;
  const m = {
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    cyan: '\x1b[36m', white: '\x1b[1m', reset: '\x1b[0m'
  };
  return m[c] + str + m.reset;
}
function printLn(str = '') {
  if (OUTPUT_MODE === 'json') return;
  console.log(str);
}

// Read remotes file
function readRemotesFile() {
  if (!fs.existsSync(REMOTES_PATH)) {
    console.error('remotes.json not found: ' + REMOTES_PATH);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(REMOTES_PATH, 'utf-8'));
  if (!data.remotes_local && !data.remotes_prod) throw new Error('remotes.json must contain "remotes_local" or "remotes_prod" keys');
  const remotes = ENV_MODE === 'local' ? data.remotes_local : data.remotes_prod;
  if (!remotes) throw new Error(`remotes.json missing key for ${ENV_MODE}: remotes_${ENV_MODE}`);
  return remotes;
}

// Fetch manifest (Node >=18)
async function fetchManifest(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    throw new Error(`Failed to fetch "${url}": ${e.message}`);
  }
}

// Resolve all manifests recursively
async function collectAllManifests(remotes) {
  const already = {};
  const queue = [];
  const graph = {};
  const fetchErrors = {}; // <--- NEW

  for (const [name, url] of Object.entries(remotes)) {
    queue.push({ name, url, parent: null });
  }

  while (queue.length > 0) {
    const { name, url } = queue.pop();
    if (already[name] || fetchErrors[name]) continue;
    let manifest;
    try {
      manifest = await fetchManifest(url);
      already[name] = manifest;
    } catch (e) {
      fetchErrors[name] = e.message || String(e);
      continue;
    }

    if (!graph[name]) graph[name] = [];
    if (manifest.remotes) {
      for (const [childName, childUrl] of Object.entries(manifest.remotes)) {
        graph[name].push(childName);
        if (!already[childName] && !fetchErrors[childName]) {
          queue.push({ name: childName, url: childUrl, parent: name });
        }
      }
    }
  }
  return { manifests: already, graph, fetchErrors };
}

function printRemotesGraph(graph) {
  function dfs(node, prefix, visited) {
    if (visited.has(node)) {
      printLn(prefix + '↳ [circular] ' + node);
      return;
    }
    visited.add(node);
    printLn(prefix + '• ' + node);
    const children = graph[node] || [];
    children.forEach((child, idx) => {
      const isLast = idx === children.length - 1;
      dfs(child, prefix + (isLast ? '└── ' : '├── '), new Set(visited));
    });
  }
  printLn('\n===================[ REMOTE DEPENDENCY GRAPH ]==================\n');
  Object.keys(graph).forEach(root => {
    dfs(root, '', new Set());
    printLn('');
  });
}

// Validate dependencies
function validateDeps(manifests) {
  let hasError = false;
  const sharedDeps = {};
  const report = [];

  Object.entries(manifests).forEach(([mfName, mf]) => {
    Object.entries(mf.dependencies || {}).forEach(([dep, info]) => {
      if (!sharedDeps[dep]) sharedDeps[dep] = [];
      sharedDeps[dep].push({
        mf: mfName,
        declared: info.declared,
        installed: info.installed,
        requiredVersion: info.requiredVersion
      });
    });
  });

  Object.entries(sharedDeps).forEach(([dep, uses]) => {
    const results = [];
    const errors = {};
    uses.forEach(u => {
      const effectiveRange = u.requiredVersion || u.declared || '-';
      const rangeSource = u.requiredVersion ? 'requiredVersion' : 'declared';
      let mismatchDef = false;
      let mismatchRemote = false;
      let remoteMismatches = [];
      if (u.installed && effectiveRange && effectiveRange !== '-') {
        mismatchDef = !semver.satisfies(u.installed, effectiveRange);
      } else if (u.installed && !effectiveRange) {
        mismatchDef = true;
      } else if (!u.installed && effectiveRange) {
        mismatchDef = true;
      }
      uses.forEach(other => {
        if (!other.declared || !u.installed) return;
        if (!semver.satisfies(u.installed, other.declared)) {
          mismatchRemote = true;
          remoteMismatches.push(`${other.mf}@${other.declared}`);
        }
      });
      let status = '';
      if (!mismatchDef && !mismatchRemote) status = 'OK';
      else {
        let parts = [];
        if (mismatchDef) parts.push('Mismatch (def)');
        if (mismatchRemote) parts.push('Mismatch (remote)');
        status = parts.join(', ');
      }
      if (mismatchDef || mismatchRemote) {
        errors[u.mf] = errors[u.mf] || [];
        if (mismatchDef) errors[u.mf].push(`Mismatch (def, ${rangeSource}): installed (${u.installed}) does not satisfy ${effectiveRange}`);
        if (mismatchRemote && remoteMismatches.length)
          errors[u.mf].push(`Mismatch (remote): installed (${u.installed}) not in range of: ${remoteMismatches.join(', ')}`);
        hasError = true;
      }
      results.push({
        project: u.mf,
        declared: u.declared || '-',
        installed: u.installed || '-',
        effectiveRange,
        rangeSource,
        status,
      });
    });
    report.push({
      dependency: dep,
      results,
      errors,
      rangeSource: results[0]?.rangeSource || 'declared',
      effectiveRange: results[0]?.effectiveRange || '-',
    });
  });

  return { hasError, report };
}

// Print fetch errors (new)
function printFetchErrors(fetchErrors) {
  if (!fetchErrors || Object.keys(fetchErrors).length === 0) return;
  printLn('\n===================[ REMOTE FETCH ERRORS ]==================');
  Object.entries(fetchErrors).forEach(([name, err]) => {
    printLn(`- ${name}: ${err}`);
  });
}

// Print reports (as antes)
function printTerminalReport(report) {
  const colProj = 14, colDeclared = 11, colInstalled = 11, colEffRange = 13, colSource = 18, colStatus = 20;
  printLn('\n===================[ SHARED DEPENDENCIES CHECK ]=================');
  report.forEach(({ dependency, results, errors, rangeSource }) => {
    printLn('\n' + color(dependency, 'white') + color(`  [${rangeSource}]`, 'cyan'));
    printLn('-'.repeat(colProj + colDeclared + colInstalled + colEffRange + colSource + colStatus + 6));
    printLn(
      pad('Project', colProj) +
      pad('Declared', colDeclared) +
      pad('Installed', colInstalled) +
      pad('Range', colEffRange) +
      pad('Source', colSource) +
      pad('Status', colStatus)
    );
    printLn('-'.repeat(colProj + colDeclared + colInstalled + colEffRange + colSource + colStatus + 6));
    results.forEach(r => {
      let statusText = r.status === 'OK'
        ? color('OK', 'green')
        : color(r.status, 'red');
      printLn(
        pad(r.project, colProj) +
        pad(r.declared, colDeclared) +
        pad(r.installed, colInstalled) +
        pad(r.effectiveRange, colEffRange) +
        pad(r.rangeSource, colSource) +
        pad(statusText, colStatus)
      );
    });
    if (Object.keys(errors).length > 0) {
      printLn('-'.repeat(colProj + colDeclared + colInstalled + colEffRange + colSource + colStatus + 6));
      printLn(color('Errors:', 'white'));
      Object.entries(errors).forEach(([proj, errs]) => {
        errs.forEach(msg => printLn(color(`  [${proj}] ${msg}`, 'red')));
      });
    }
    printLn('');
  });
}
function printTxtReport(report) {
  const colProj = 14, colDeclared = 11, colInstalled = 11, colEffRange = 13, colSource = 13, colStatus = 20;
  console.log('\n===================[ SHARED DEPENDENCIES CHECK ]=================');
  report.forEach(({ dependency, results, errors, rangeSource }) => {
    console.log('\n' + dependency + `  [${rangeSource}]`);
    console.log('-'.repeat(colProj + colDeclared + colInstalled + colEffRange + colSource + colStatus + 6));
    console.log(
      pad('Project', colProj) +
      pad('Declared', colDeclared) +
      pad('Installed', colInstalled) +
      pad('Range', colEffRange) +
      pad('Source', colSource) +
      pad('Status', colStatus)
    );
    console.log('-'.repeat(colProj + colDeclared + colInstalled + colEffRange + colSource + colStatus + 6));
    results.forEach(r => {
      let statusText = r.status;
      console.log(
        pad(r.project, colProj) +
        pad(r.declared, colDeclared) +
        pad(r.installed, colInstalled) +
        pad(r.effectiveRange, colEffRange) +
        pad(r.rangeSource, colSource) +
        pad(statusText, colStatus)
      );
    });
    if (Object.keys(errors).length > 0) {
      console.log('-'.repeat(colProj + colDeclared + colInstalled + colEffRange + colSource + colStatus + 6));
      console.log('Errors:');
      Object.entries(errors).forEach(([proj, errs]) => {
        errs.forEach(msg => console.log(`  [${proj}] ${msg}`));
      });
    }
    console.log('');
  });
}
function printMarkdownReport(report) {
  report.forEach(({ dependency, results, errors, rangeSource }) => {
    console.log(`\n### ${dependency}  \n_Source: ${rangeSource}_\n`);
    console.log('| Project | Declared | Installed | Range | Source | Status |');
    console.log('|---------|----------|-----------|-------|--------|--------|');
    results.forEach(r => {
      let status = r.status === 'OK'
        ? '✅ OK'
        : `❌ ${r.status}`;
      console.log(`| ${r.project} | ${r.declared} | ${r.installed} | ${r.effectiveRange} | ${r.rangeSource} | ${status} |`);
    });
    if (Object.keys(errors).length > 0) {
      console.log('\n**Errors:**');
      Object.entries(errors).forEach(([proj, errs]) => {
        errs.forEach(msg => console.log(`- [${proj}] ${msg}`));
      });
    }
    console.log('\n---');
  });
}
function printJsonReport(report) {
  console.log(JSON.stringify(report, null, 2));
}

// MAIN
(async () => {
  try {
    const remotes = readRemotesFile();

    // Header
    if (OUTPUT_MODE === 'terminal') {
      printLn(color('\nREMOTE VALIDATOR - MFE REMOTES\n', 'cyan'));
      printLn(`Mode: ${color(ENV_MODE, 'white')}`);
      printLn('Configured remotes:');
      Object.entries(remotes).forEach(([name, url]) =>
        printLn('- ' + pad(name, 15) + url)
      );
    } else if (OUTPUT_MODE === 'md') {
      printLn(`# Remote Validator - MFE Remotes`);
      printLn(`**Mode:** ${ENV_MODE}`);
      printLn('**Configured remotes:**');
      Object.entries(remotes).forEach(([name, url]) =>
        printLn(`- ${name}: ${url}`)
      );
    }

    const { manifests, graph, fetchErrors } = await collectAllManifests(remotes);

    if (OUTPUT_MODE === 'terminal' || OUTPUT_MODE === 'txt')
      printRemotesGraph(graph);

    // Validate & print
    const { hasError, report } = validateDeps(manifests);

    if (OUTPUT_MODE === 'json') printJsonReport(report);
    else if (OUTPUT_MODE === 'md') printMarkdownReport(report);
    else if (OUTPUT_MODE === 'txt') printTxtReport(report);
    else printTerminalReport(report);

    // Print fetch errors (at end)
    if (Object.keys(fetchErrors).length > 0) {
      if (OUTPUT_MODE === 'json') {
        console.log('\n{"fetchErrors":', JSON.stringify(fetchErrors, null, 2), "}");
      } else if (OUTPUT_MODE === 'md') {
        console.log('\n### Remote Fetch Errors');
        Object.entries(fetchErrors).forEach(([name, err]) =>
          console.log(`- **${name}**: ${err}`)
        );
      } else {
        printFetchErrors(fetchErrors);
      }
    }

    if (hasError || Object.keys(fetchErrors).length > 0) {
      if (OUTPUT_MODE === 'terminal') printLn('\n' + color('❌ Compatibility errors found or fetch failures!', 'red'));
      else if (OUTPUT_MODE === 'md' || OUTPUT_MODE === 'txt') printLn('\n❌ Compatibility errors found or fetch failures!');
    } else {
      if (OUTPUT_MODE === 'terminal') printLn('\n' + color('✅ All shared dependencies are compatible!', 'green'));
      else if (OUTPUT_MODE === 'md' || OUTPUT_MODE === 'txt') printLn('\n✅ All shared dependencies are compatible!');
    }
  } catch (e) {
    printLn('\n' + color('[ERROR] General failure: ', 'red') + (e.message || e));
    process.exit(1);
  }
})();
