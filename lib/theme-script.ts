// Tema claro/escuro: chave no localStorage e o script que aplica a classe antes
// da primeira pintura (evita o "piscar"). Sem "use client": o layout raiz
// (Server Component) injeta o script com next/script beforeInteractive.

export const THEME_STORAGE_KEY = "theme"; // mesma chave do next-themes: preserva a escolha salva
export const DEFAULT_THEME = "dark";

export const THEME_SCRIPT = `(function(){try{
var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||${JSON.stringify(DEFAULT_THEME)};
var d=t==="system"?matchMedia("(prefers-color-scheme: dark)").matches:t==="dark";
var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";
}catch(_){}})();`;
