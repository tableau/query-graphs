if(!self.define){let e,t={};const r=(r,i)=>(r=new URL(r+".js",i).href,t[r]||new Promise((t=>{if("document"in self){const e=document.createElement("script");e.src=r,e.onload=t,document.head.appendChild(e)}else e=r,importScripts(r),t()})).then((()=>{let e=t[r];if(!e)throw new Error(`Module ${r} didn’t register its module`);return e})));self.define=(i,n)=>{const o=e||("document"in self?document.currentScript.src:"")||location.href;if(t[o])return;let s={};const d=e=>r(e,o),c={module:{uri:o},exports:s,require:d};t[o]=Promise.all(i.map((e=>c[e]||d(e)))).then((e=>(n(...e),s)))}}define(["./workbox-14b70077"],(function(e){"use strict";self.skipWaiting(),e.clientsClaim(),e.precacheAndRoute([{url:"bundle.js",revision:"50ea0b6a3a92993577dd57646e00c09d"},{url:"index.html",revision:"73e06f82a7cb0d4ff7b9e04756732dd8"}],{ignoreURLParametersMatching:[/./]})}));
