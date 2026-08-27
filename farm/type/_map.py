import json, numpy as np
from PIL import Image, ImageDraw
lab = np.load("farm/type/_lab.npy")
src = Image.open("Type/sample.jpeg").convert("RGB")
d = ImageDraw.Draw(src)
from scipy import ndimage
objs = ndimage.find_objects(lab)
ids = [i for i in range(1, lab.max()+1) if objs[i-1] is not None and (lab[objs[i-1]]==i).sum() >= 120]
for k in ids:
    sl = objs[k-1]
    y0,y1,x0,x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
    if y0 > 930: continue
    d.rectangle([x0,y0,x1,y1], outline=(255,60,60), width=3)
    d.text((x0+4, y0-2), str(k), fill=(0,140,255))
src.resize((1600, int(1600*src.height/src.width))).save("/private/tmp/claude-944140629/-Users-hudson-powell-Desktop-Archive-SORT-IT-OUT--Developer-EngineGame/1d180979-f9c5-425c-a91a-10fa3adc93d2/scratchpad/map.png")
print(sorted(ids))
