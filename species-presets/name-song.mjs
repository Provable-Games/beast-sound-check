// One local worker, one running request and at most one waiting selection.
// A small LRU keeps revisiting a name instant without retaining the whole catalogue.
export class NameSongs {
  constructor(manifest) { this.manifest=manifest; this.cache=new Map(); this.sequence=0; }
  async worker() {
    if (!this.starting) this.starting=(async()=>{
      const url=new URL(`names/${this.manifest.worker.file}`,import.meta.url);
      const response=await fetch(url); if(!response.ok)throw new Error('Could not load Name Song composer');
      const code=await response.arrayBuffer();
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',code)),b=>b.toString(16).padStart(2,'0')).join('');
      if(hash!==this.manifest.worker.sha256)throw new Error('Name Song composer failed its content check');
      const blob=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
      try {
        const worker=new Worker(blob);
        worker.onmessage=({data})=>this.finish(data);
        worker.onerror=()=>this.reset(new Error('Name Song composer could not run. Tap Play to retry.'));
        this.instance=worker; return worker;
      }finally{URL.revokeObjectURL(blob)}
    })().catch(error=>{this.starting=null;throw error});
    return this.starting;
  }
  compose(sid,fx,name) {
    const key=`${sid}-${fx}-${name}`;
    if(this.cache.has(key)) { const value=this.cache.get(key);this.cache.delete(key);this.cache.set(key,value);return Promise.resolve(value); }
    return new Promise((resolve,reject)=>{
      this.waiting?.reject(new Error('Selection superseded'));
      this.waiting={key,input:{sid,kind:'name',fx,name,edition:0,seed:'0'},request:++this.sequence,resolve,reject};
      this.pump();
    });
  }
  async pump() {
    if(this.running||!this.waiting)return;
    const task=this.running=this.waiting;this.waiting=null;
    try { const worker=await this.worker();if(this.running!==task)return;worker.postMessage({request:task.request,input:task.input,dataUrl:new URL(`names/${this.manifest.data.file}`,import.meta.url).href}); }
    catch(error){this.finish({request:task.request,error:error.message})}
  }
  finish(data) {
    const task=this.running;if(!task||task.request!==data.request)return;
    this.running=null;
    if(data.error)task.reject(new Error(data.error));
    else {this.cache.set(task.key,data);if(this.cache.size>24)this.cache.delete(this.cache.keys().next().value);task.resolve(data)}
    this.pump();
  }
  reset(error) {
    this.instance?.terminate();this.instance=null;this.starting=null;
    this.running?.reject(error);this.running=null;this.waiting?.reject(error);this.waiting=null;
  }
  dispose(){this.reset(new Error('Composer closed'))}
}
