// Ponte mínima entre a página (sem acesso ao Node) e o main.js: um canal de pedidos e um de eventos.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('painel', {
  /** Pede uma ação da lista fixa do main.js. Devolve { ok } ou { erro } */
  pedir: (acao, dados) => ipcRenderer.invoke('painel', acao, dados),
  /** Eventos ao vivo: conversa de um lead (slug) ou progresso de uma tarefa (slug vazio) */
  ouvir: (fn) => { ipcRenderer.on('painel:evento', (_e, slug, linha) => fn(slug, linha)); },
});
