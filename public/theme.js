"use strict";
(()=>{
  const key="studyorbit.theme",root=document.documentElement;
  let theme="light";
  try{const saved=localStorage.getItem(key);if(saved==="dark"||saved==="light")theme=saved;}catch{}
  function apply(value){
    theme=value;root.dataset.theme=theme;
    const button=document.getElementById("themeToggle");
    if(button){const label=theme==="dark"?"Switch to light mode":"Switch to dark mode";button.setAttribute("aria-label",label);button.setAttribute("title",label);button.setAttribute("aria-pressed",String(theme==="dark"));}
  }
  // Apply the saved choice before the page is painted.
  apply(theme);
  document.addEventListener("DOMContentLoaded",()=>{
    apply(theme);
    document.getElementById("themeToggle")?.addEventListener("click",()=>{
      apply(theme==="dark"?"light":"dark");
      try{localStorage.setItem(key,theme);}catch{}
    });
  });
  window.addEventListener("storage",event=>{if(event.key===key)apply(event.newValue==="dark"?"dark":"light");});
})();
