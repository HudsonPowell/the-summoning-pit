import { writeFileSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { PixelRenderer, Camera } from '../src/render';
import { Capsule } from '../src/pose';
import { v3 } from '../src/vec';
const S = 46 * 4;
const INK: [number,number,number] = [150,160,172], OFF: [number,number,number] = [196,96,84];
function speaker(muted: boolean): Capsule[] {
  const c: Capsule[] = [];
  const put = (ax:number,ay:number,bx:number,by:number,r:number,col=INK)=>c.push({a:v3(ax,ay,0),b:v3(bx,by,0),r,color:col,part:'icon'});
  put(-0.34,0,-0.16,0,0.17); put(-0.05,0.34,-0.05,-0.34,0.13);
  put(-0.16,0.2,-0.05,0.3,0.1); put(-0.16,-0.2,-0.05,-0.3,0.1);
  if (muted) put(0.06,0.36,0.52,-0.36,0.075,OFF);
  else for (const [rad,seg] of [[0.26,3],[0.44,4]] as const)
    for (let i=0;i<seg;i++){const a0=-0.7+(i/seg)*1.4,a1=-0.7+((i+1)/seg)*1.4;
      put(0.1+Math.cos(a0)*rad,Math.sin(a0)*rad,0.1+Math.cos(a1)*rad,Math.sin(a1)*rad,0.055);}
  return c;
}
mkdirSync('farm/out',{recursive:true});
const r = new PixelRenderer(S,S), buf = new Uint8ClampedArray(S*S*4);
const VARIANTS: [number, boolean][] = [[1.4,false],[0.55,false],[0.2,false],[1.4,true],[0.55,true],[0.2,true]];
const sheet = new PNG({width:S*VARIANTS.length,height:S});
VARIANTS.forEach(([bl,m],i)=>{
  const cam: Camera = {yaw:0,pitch:0,ppm:S*0.62,cy:0,floor:false,blend:bl,blendShape:0.5,blendMix:1,flat:true,voidColor:[10,8,14]};
  r.render(buf, speaker(m), cam, 0);
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){const s=(y*S+x)*4,d=(y*sheet.width+i*S+x)*4;
    sheet.data[d]=buf[s];sheet.data[d+1]=buf[s+1];sheet.data[d+2]=buf[s+2];sheet.data[d+3]=255;}
});
writeFileSync('farm/out/icon.png', PNG.sync.write(sheet));
console.log('farm/out/icon.png');
