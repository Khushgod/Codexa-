const compileDefaults = {
  timeMs: 15_000,
  memoryMb: 768,
  outputBytes: 64 * 1024,
  pidsLimit: 64,
};

export const languages = Object.freeze({
  cpp: Object.freeze({
    id: 'cpp',
    fileName: 'main.cpp',
    compileCmd: ['g++', '-std=c++17', '-O2', '-pipe', '-o', '/work/program', '/work/main.cpp'],
    runCmd: ['/work/program'],
    timeMultiplier: 1,
    memoryOverhead: 32,
    pidsLimit: 64,
    compileLimits: Object.freeze(compileDefaults),
    runLimits: Object.freeze({
      timeMs: 1000,
      memoryMb: 256,
      outputBytes: 256 * 1024,
      pidsLimit: 64,
    }),
  }),
  python: Object.freeze({
    id: 'python',
    fileName: 'main.py',
    compileCmd: ['python3', '-B', '-m', 'py_compile', '/work/main.py'],
    runCmd: ['python3', '-B', '/work/main.py'],
    timeMultiplier: 4,
    memoryOverhead: 48,
    pidsLimit: 64,
    compileLimits: Object.freeze({ ...compileDefaults, memoryMb: 512 }),
    runLimits: Object.freeze({
      timeMs: 1000,
      memoryMb: 256,
      outputBytes: 256 * 1024,
      pidsLimit: 64,
    }),
  }),
  java: Object.freeze({
    id: 'java',
    fileName: 'Main.java',
    compileCmd: ['javac', '-encoding', 'UTF-8', '/work/Main.java'],
    runCmd: ['java', '-Xmx256m', '-Xss2m', '-XX:+UseSerialGC', '-cp', '/work', 'Main'],
    timeMultiplier: 2,
    memoryOverhead: 96,
    pidsLimit: 128,
    compileLimits: Object.freeze({ ...compileDefaults, memoryMb: 1024, pidsLimit: 128 }),
    runLimits: Object.freeze({
      timeMs: 1000,
      memoryMb: 384,
      outputBytes: 256 * 1024,
      pidsLimit: 128,
    }),
  }),
});

export function getLanguage(language) {
  const config = languages[language];
  if (!config) throw new Error(`Unsupported language: ${language}`);
  return config;
}

export function limitsFor(problem, language) {
  const config = getLanguage(language);
  return {
    timeMs: Math.ceil(problem.timeLimitMs * config.timeMultiplier),
    memoryMb: problem.memoryLimitMb + config.memoryOverhead,
    outputBytes: config.runLimits.outputBytes,
    pidsLimit: config.pidsLimit,
    compile: config.compileLimits,
  };
}
