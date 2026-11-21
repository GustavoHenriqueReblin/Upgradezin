// Arquivos de texto importados como string (Vite/Vitest: `import x from './a.txt?raw'`), usados nos testes.
declare module '*?raw' {
  const content: string;
  export default content;
}
