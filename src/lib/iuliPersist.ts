import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

// Filtros das telas do Financeiro IULI lembrados por tela: sair e voltar pelo
// menu (que abre a tela sem ?filtros na URL) restaura o último filtro usado
// naquela tela. Link com filtro na URL continua tendo prioridade.
// localStorage pode falhar (aba anônima, bloqueio) — aí só não lembra.

const PREFIX = "farol:iuli:";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // sem armazenamento: segue sem lembrar
  }
}

/** useSearchParams que lembra os parâmetros da tela atual. */
export function usePersistentSearchParams() {
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const key = `filtros:${pathname}`;
  const urlHasParams = params.toString() !== "";
  const stored = useMemo(() => read(key), [key]);

  // Chegou sem filtro na URL e tem filtro salvo: usa o salvo já neste render
  // (sem piscar o padrão) e grava na URL em seguida.
  const effective = useMemo(
    () => (urlHasParams || !stored ? params : new URLSearchParams(stored)),
    [params, urlHasParams, stored],
  );

  useEffect(() => {
    if (!urlHasParams && stored) setParams(new URLSearchParams(stored), { replace: true });
    // só ao entrar na tela
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Filtro que chegou pela URL (link compartilhado, voltar do navegador) também fica lembrado.
  useEffect(() => {
    if (urlHasParams) write(key, params.toString());
  }, [key, params, urlHasParams]);

  const set = (next: URLSearchParams) => {
    write(key, next.toString());
    setParams(next, { replace: true });
  };

  return [effective, set] as const;
}

/** useState que lembra o valor (ex: ordenação, busca de uma lista). */
export function usePersistentState<T extends string>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => (read(`estado:${key}`) as T | null) ?? initial);
  const set = (next: T) => {
    write(`estado:${key}`, next);
    setValue(next);
  };
  return [value, set] as const;
}
