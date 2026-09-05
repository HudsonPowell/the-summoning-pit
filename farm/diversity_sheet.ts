// Real engine render of procedural design studies and cleaned weapon carries.
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { anatomyStudy } from '../src/diversity';
import { validateGenome } from '../src/hatch';
import { sanitiseGenome } from '../server/sanitise';
import { defaultBiped } from '../src/genome';
import { makeCharacter } from '../src/character';
import { weaponsFromWords } from '../src/smith';
import { solvePose, Capsule } from '../src/pose';
import { PixelRenderer } from '../src/render';
import { rotX, rotY } from '../src/vec';
import { drawText } from './font';

const out = resolve(process.argv[2] ?? 'farm/out/diversity'); mkdirSync(out,{recursive:true});
const W=224,H=240;
const renderer=new PixelRenderer(W,H);
function sheet(items:{name:string;caps:Capsule[]}[],cols:number,title:string,file:string) {
  const rows=Math.ceil(items.length/cols), banner=44;
  const png=new PNG({width:W*cols,height:H*rows+banner});
  for(let i=0;i<png.data.length;i+=4) { png.data[i]=13;png.data[i+1]=16;png.data[i+2]=22;png.data[i+3]=255; }
  drawText(png.data,png.width,png.height,title,18,15,[223,224,213],2);
  items.forEach((item,index)=>{
    const yaw=0.55,pitch=0.18;
    const bounds=item.caps.flatMap(c=>[c.a,c.b].map(p=>({p:rotX(rotY(p,yaw),pitch),r:c.r})));
    const minX=Math.min(...bounds.map(b=>b.p.x-b.r)),maxX=Math.max(...bounds.map(b=>b.p.x+b.r));
    const minY=Math.min(...bounds.map(b=>b.p.y-b.r)),maxY=Math.max(...bounds.map(b=>b.p.y+b.r));
    const ppm=Math.min((W-38)/(maxX-minX),(H-60)/(maxY-minY),130);
    const offset=rotY(rotX({x:(minX+maxX)/2,y:0,z:0},-pitch),-yaw);
    const caps=item.caps.map(c=>({...c,a:{x:c.a.x-offset.x,y:c.a.y-offset.y,z:c.a.z-offset.z},b:{x:c.b.x-offset.x,y:c.b.y-offset.y,z:c.b.z-offset.z}}));
    const pixels=new Uint8ClampedArray(W*H*4);
    renderer.render(pixels,caps,{yaw,pitch,ppm,cy:(minY+maxY)/2,floor:false},0);
    const x=(index%cols)*W,y=Math.floor(index/cols)*H+banner;
    for(let py=0;py<H;py++)for(let px=0;px<W;px++){
      const s=(py*W+px)*4,d=((py+y)*png.width+px+x)*4;
      if(pixels[s+3]){ png.data[d]=pixels[s];png.data[d+1]=pixels[s+1];png.data[d+2]=pixels[s+2]; }
    }
    drawText(png.data,png.width,png.height,item.name,x+14,y+H-22,[134,148,158]);
  });
  writeFileSync(resolve(out,file),PNG.sync.write(png));
}
const creatures=Array.from({length:24},(_,i)=>{
  const g=sanitiseGenome(validateGenome(anatomyStudy(i+1),'an invented creature'))!;
  return {name:`STUDY ${String(i+1).padStart(2,'0')}`,caps:solvePose(g,{tired:0,angry:0},0.32,1,2)};
});
sheet(creatures,6,'BODY STRUCTURE STUDIES - ENGINE RENDERS','figure-diversity.png');
const names=['sword','greatsword','axe','hammer','staff','spear','longbow','crossbow','scimitar','shield','dagger','trident'];
const carries=names.map(name=>{
  const g=defaultBiped();delete g.weapon;
  const w=weaponsFromWords(name);g.weapon=w.main;g.offhand=w.off;
  const ch=makeCharacter(g,'hero');
  return {name,caps:solvePose(g,{tired:0,angry:0},0.32,1,2,undefined,0,{weapon:ch.weapon,offhand:ch.offhand})};
});
sheet(carries,6,'WEAPONS - CONNECTED GRIPS AND CARRYING POSES','weapon-carries.png');
console.log(out);
