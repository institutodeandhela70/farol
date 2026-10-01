// Singleton não-React para o workspace ativo — usado por código fora da árvore de
// componentes (ex.: services/), que não pode chamar useContext. A fonte de verdade
// "oficial" continua sendo o WorkspaceProvider; isto é só um espelho de leitura rápida.
const STORAGE_KEY = "farol.activeWorkspaceId";

let activeWorkspaceId: string | null = null;

export function getActiveWorkspaceId(): string | null {
  if (activeWorkspaceId) return activeWorkspaceId;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function peekActiveWorkspaceId(): string | null {
  return activeWorkspaceId;
}

export function setActiveWorkspaceId(id: string | null) {
  activeWorkspaceId = id;
  if (id) {
    window.localStorage.setItem(STORAGE_KEY, id);
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}
