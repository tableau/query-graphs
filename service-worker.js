if(!self.define){let e,t={};const r=(r,i)=>(r=new URL(r+".js",i).href,t[r]||new Promise((t=>{if("document"in self){const e=document.createElement("script");e.src=r,e.onload=t,document.head.appendChild(e)}else e=r,importScripts(r),t()})).then((()=>{let e=t[r];if(!e)throw new Error(`Module ${r} didn’t register its module`);return e})));self.define=(i,n)=>{const o=e||("document"in self?document.currentScript.src:"")||location.href;if(t[o])return;let s={};const c=e=>r(e,o),d={module:{uri:o},exports:s,require:c};t[o]=Promise.all(i.map((e=>d[e]||c(e)))).then((e=>(n(...e),s)))}}define(["./workbox-f7982d9c"],(function(e){"use strict";self.skipWaiting(),e.clientsClaim(),e.precacheAndRoute([{url:"bundle.js",revision:"9a8c07babfc0423e8564c7d44e3a52df"},{url:"index.html",revision:"73e06f82a7cb0d4ff7b9e04756732dd8"}],{ignoreURLParametersMatching:[/./]})}));