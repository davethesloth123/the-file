"""
Humanoid v2 — lofted from anatomical cross-sections rather than plain tubes.

Improvements over v1: tapered waist and shoulder shelf, deltoid mass, calf
bulge, a head with brow/cheek/jaw/chin, actual hands and shoes, superelliptical
sections (torsos are wider than they are deep), and smooth normals computed
from the surface instead of guessed analytically.
"""
import numpy as np, json, math

J = {
    'Hips':          (0.000, 0.960, 0.000),
    'Spine':         (0.000, 1.055, 0.000),
    'Spine1':        (0.000, 1.165, 0.000),
    'Spine2':        (0.000, 1.285, 0.000),
    'Neck':          (0.000, 1.430, 0.000),
    'Head':          (0.000, 1.510, 0.000),
    'HeadTop_End':   (0.000, 1.700, 0.000),
    'LeftShoulder':  ( 0.045, 1.395, 0.000),
    'LeftArm':       ( 0.175, 1.375, 0.000),
    'LeftForeArm':   ( 0.235, 1.115, 0.000),
    'LeftHand':      ( 0.278, 0.885, 0.000),
    'LeftHand_End':  ( 0.295, 0.790, 0.000),
    'RightShoulder': (-0.045, 1.395, 0.000),
    'RightArm':      (-0.175, 1.375, 0.000),
    'RightForeArm':  (-0.235, 1.115, 0.000),
    'RightHand':     (-0.278, 0.885, 0.000),
    'RightHand_End': (-0.295, 0.790, 0.000),
    'LeftUpLeg':     ( 0.098, 0.935, 0.000),
    'LeftLeg':       ( 0.105, 0.510, 0.000),
    'LeftFoot':      ( 0.108, 0.085, 0.000),
    'LeftToe_End':   ( 0.108, 0.028, 0.145),
    'RightUpLeg':    (-0.098, 0.935, 0.000),
    'RightLeg':      (-0.105, 0.510, 0.000),
    'RightFoot':     (-0.108, 0.085, 0.000),
    'RightToe_End':  (-0.108, 0.028, 0.145),
}
PARENT = {
    'Hips':None,'Spine':'Hips','Spine1':'Spine','Spine2':'Spine1','Neck':'Spine2',
    'Head':'Neck','HeadTop_End':'Head',
    'LeftShoulder':'Spine2','LeftArm':'LeftShoulder','LeftForeArm':'LeftArm',
    'LeftHand':'LeftForeArm','LeftHand_End':'LeftHand',
    'RightShoulder':'Spine2','RightArm':'RightShoulder','RightForeArm':'RightArm',
    'RightHand':'RightForeArm','RightHand_End':'RightHand',
    'LeftUpLeg':'Hips','LeftLeg':'LeftUpLeg','LeftFoot':'LeftLeg','LeftToe_End':'LeftFoot',
    'RightUpLeg':'Hips','RightLeg':'RightUpLeg','RightFoot':'RightLeg','RightToe_End':'RightFoot',
}
BONES = list(J.keys()); BIDX = {b:i for i,b in enumerate(BONES)}

verts, joints, weights, tris = [], [], [], []
SEG = 14

# spine chain used for weighting anything on the trunk
SPINE = ['Hips','Spine','Spine1','Spine2','Neck','Head']
SPINE_Y = [J[b][1] for b in SPINE]

def spine_weights(y):
    """Blend a trunk vertex between the two nearest spine bones by height."""
    if y <= SPINE_Y[0]:  return [('Hips',1.0)]
    if y >= SPINE_Y[-1]: return [('Head',1.0)]
    for i in range(len(SPINE)-1):
        a,b = SPINE_Y[i], SPINE_Y[i+1]
        if a <= y <= b:
            t = (y-a)/(b-a)
            return [(SPINE[i],1.0-t),(SPINE[i+1],t)]
    return [('Hips',1.0)]

def add_vert(p, bw):
    verts.append(tuple(p))
    js=[BIDX[b] for b,_ in bw][:4]; ws=[w for _,w in bw][:4]
    while len(js)<4: js.append(0); ws.append(0.0)
    s=sum(ws) or 1.0
    joints.append(js); weights.append([w/s for w in ws])

def sect(cx, cy, cz, rx, rz, n=2.0, bw=None):
    """One superelliptical cross-section. n=2 is a circle; higher is boxier."""
    base=len(verts)
    for i in range(SEG):
        a=2*math.pi*i/SEG
        ca,sa=math.cos(a),math.sin(a)
        x=cx+rx*math.copysign(abs(ca)**(2.0/n),ca)
        z=cz+rz*math.copysign(abs(sa)**(2.0/n),sa)
        add_vert((x,cy,z), bw if bw else spine_weights(cy))
    return base

def stitch(a,b):
    for i in range(SEG):
        j=(i+1)%SEG
        tris.extend([a+i,b+i,a+j, a+j,b+i,b+j])

def cap(base, c, bw, flip=False):
    ci=len(verts); add_vert(c, bw)
    for i in range(SEG):
        j=(i+1)%SEG
        tris.extend([ci,base+j,base+i] if flip else [ci,base+i,base+j])

def loft(levels, bw_fn=None, capTop=True, capBot=True, n=2.0):
    rings=[]
    for (y,rx,rz,zo) in levels:
        bw = bw_fn(y) if bw_fn else spine_weights(y)
        rings.append(sect(0,y,zo,rx,rz,n,bw))
    for a,b in zip(rings,rings[1:]): stitch(a,b)
    if capBot: cap(rings[0], (0,levels[0][0],levels[0][3]),
                   bw_fn(levels[0][0]) if bw_fn else spine_weights(levels[0][0]), flip=True)
    if capTop: cap(rings[-1], (0,levels[-1][0],levels[-1][3]),
                   bw_fn(levels[-1][0]) if bw_fn else spine_weights(levels[-1][0]))
    return rings

# ------------------------------------------------------------------ torso
# (y, half-width, half-depth, z-offset). Waist in, chest out, shoulder shelf.
TORSO = [
    (0.855, 0.163, 0.122, 0.000),
    (0.930, 0.170, 0.126, 0.000),
    (1.010, 0.152, 0.114, 0.002),
    (1.070, 0.143, 0.107, 0.004),   # waist
    (1.150, 0.158, 0.117, 0.004),
    (1.235, 0.180, 0.130, 0.002),   # ribcage
    (1.320, 0.194, 0.129, 0.000),   # chest
    (1.395, 0.188, 0.117,-0.002),   # shoulder line
    (1.445, 0.116, 0.098,-0.004),   # trapezius
    (1.490, 0.061, 0.060,-0.004),   # neck base
    (1.545, 0.056, 0.057,-0.002),
]
loft(TORSO, n=2.6)

# ------------------------------------------------------------------- coat
# Hip-length jacket. A greatcoat hem would intersect the thighs at full stride.
def coat_w(y):
    return [('Hips',1.0)] if y < 0.955 else spine_weights(y)
COAT = [
    (0.800, 0.222, 0.172, 0.000),   # hem
    (0.880, 0.212, 0.163, 0.000),
    (0.960, 0.199, 0.152, 0.000),
    (1.060, 0.176, 0.135, 0.004),
    (1.170, 0.187, 0.140, 0.004),
    (1.270, 0.208, 0.148, 0.002),
    (1.370, 0.213, 0.137, 0.000),
    (1.420, 0.196, 0.122,-0.003),
    (1.452, 0.128, 0.104,-0.005),
]
loft(COAT, bw_fn=coat_w, capTop=False, n=2.7)

# ------------------------------------------------------------------- limbs
def chain(pts, side):
    """pts: (bone, t, radius). Rings placed along bone segments."""
    rings=[]
    for (b0,b1,t,r) in pts:
        p0,p1=np.array(J[b0]),np.array(J[b1])
        pos=p0+(p1-p0)*t
        bw=[(b0,1.0-t*0.62),(b1,t*0.62)] if t<0.5 else [(b0,1.0-t),(b1,t)]
        rings.append(sect(pos[0],pos[1],pos[2],r,r*0.92,2.0,bw))
    for a,b in zip(rings,rings[1:]): stitch(a,b)
    return rings

for s in ('Left','Right'):
    # arm: deltoid, taper to elbow, forearm swell, wrist
    r=chain([(f'{s}Arm',f'{s}ForeArm',0.00,0.086),
             (f'{s}Arm',f'{s}ForeArm',0.18,0.068),
             (f'{s}Arm',f'{s}ForeArm',0.55,0.058),
             (f'{s}Arm',f'{s}ForeArm',1.00,0.053),
             (f'{s}ForeArm',f'{s}Hand',0.22,0.055),
             (f'{s}ForeArm',f'{s}Hand',0.62,0.044),
             (f'{s}ForeArm',f'{s}Hand',1.00,0.036)], s)
    cap(r[0], tuple(np.array(J[f'{s}Arm'])+np.array([0,0.03,0])), [(f'{s}Arm',1.0)])
    # hand: a mitten, flattened front-to-back
    hp=np.array(J[f'{s}Hand'])
    h1=sect(hp[0],hp[1]-0.02,0.004,0.046,0.026,2.4,[(f'{s}Hand',1.0)])
    h2=sect(hp[0],hp[1]-0.070,0.010,0.043,0.024,2.4,[(f'{s}Hand',1.0)])
    h3=sect(hp[0],hp[1]-0.100,0.012,0.028,0.018,2.2,[(f'{s}Hand',1.0)])
    stitch(r[-1],h1); stitch(h1,h2); stitch(h2,h3)
    cap(h3,(hp[0],hp[1]-0.112,0.012),[(f'{s}Hand',1.0)])

    # leg: thigh, knee, calf bulge, ankle
    lr=chain([(f'{s}UpLeg',f'{s}Leg',0.00,0.108),
              (f'{s}UpLeg',f'{s}Leg',0.28,0.098),
              (f'{s}UpLeg',f'{s}Leg',0.70,0.080),
              (f'{s}UpLeg',f'{s}Leg',1.00,0.069),
              (f'{s}Leg',f'{s}Foot',0.18,0.076),   # calf
              (f'{s}Leg',f'{s}Foot',0.55,0.061),
              (f'{s}Leg',f'{s}Foot',1.00,0.044)], s)
    cap(lr[0], tuple(np.array(J[f'{s}UpLeg'])+np.array([0,0.05,0])), [(f'{s}UpLeg',1.0)])
    # shoe
    fp=np.array(J[f'{s}Foot'])
    s1=sect(fp[0],fp[1]-0.012,0.010,0.049,0.052,2.6,[(f'{s}Foot',1.0)])
    s2=sect(fp[0],fp[1]-0.048,0.045,0.052,0.088,3.0,[(f'{s}Foot',1.0)])
    s3=sect(fp[0],fp[1]-0.058,0.105,0.046,0.058,3.0,[(f'{s}Foot',1.0)])
    stitch(lr[-1],s1); stitch(s1,s2); stitch(s2,s3)
    cap(s3,(fp[0],fp[1]-0.060,0.140),[(f'{s}Foot',1.0)])
    cap(s2,(fp[0],fp[1]-0.062,0.045),[(f'{s}Foot',1.0)],flip=True)

# -------------------------------------------------------------------- head
HC = J['Head'][1] + 0.082
HW = [('Head',1.0)]
HEAD = [
    (HC+0.118, 0.040, 0.046,-0.004),
    (HC+0.100, 0.070, 0.079,-0.006),
    (HC+0.070, 0.086, 0.094,-0.006),
    (HC+0.038, 0.092, 0.100,-0.004),   # temple
    (HC+0.012, 0.091, 0.101, 0.000),   # brow
    (HC-0.012, 0.086, 0.099, 0.002),   # eye line
    (HC-0.040, 0.079, 0.093, 0.004),   # cheek
    (HC-0.066, 0.067, 0.084, 0.006),   # jaw
    (HC-0.090, 0.048, 0.068, 0.010),   # chin
    (HC-0.108, 0.026, 0.040, 0.006),
    (HC-0.135, 0.048, 0.050,-0.006),   # under-jaw into neck
    (HC-0.165, 0.055, 0.056,-0.006),
]
loft(HEAD, bw_fn=lambda y: HW, n=2.3)

# nose: bridge to tip, sitting proud of the brow line
def box(pts, bw):
    b=len(verts)
    for p in pts: add_vert(p, bw)
    for f in [(0,1,2),(0,2,3),(4,6,5),(4,7,6),(0,4,5),(0,5,1),
              (3,2,6),(3,6,7),(0,3,7),(0,7,4),(1,5,6),(1,6,2)]:
        tris.extend([b+f[0],b+f[1],b+f[2]])
box([(-0.017,HC+0.010,0.086),( 0.017,HC+0.010,0.086),
     ( 0.017,HC-0.038,0.090),(-0.017,HC-0.038,0.090),
     (-0.009,HC+0.004,0.108),( 0.009,HC+0.004,0.108),
     ( 0.011,HC-0.036,0.122),(-0.011,HC-0.036,0.122)], HW)
# brow ridge — a shallow shelf reads as a face under toon shading
box([(-0.078,HC+0.026,0.070),( 0.078,HC+0.026,0.070),
     ( 0.078,HC+0.014,0.078),(-0.078,HC+0.014,0.078),
     (-0.072,HC+0.020,0.084),( 0.072,HC+0.020,0.084),
     ( 0.072,HC+0.008,0.090),(-0.072,HC+0.008,0.090)], HW)
# ears
for sx in (-1,1):
    box([(sx*0.086,HC+0.020,-0.012),(sx*0.098,HC+0.020,-0.012),
         (sx*0.098,HC-0.030,-0.008),(sx*0.086,HC-0.030,-0.008),
         (sx*0.086,HC+0.016, 0.020),(sx*0.098,HC+0.016, 0.020),
         (sx*0.098,HC-0.028, 0.022),(sx*0.086,HC-0.028, 0.022)], HW)

verts=np.array(verts,dtype=np.float32)
tris=np.array(tris,dtype=np.uint16)
joints=np.array(joints,dtype=np.uint16)
weights=np.array(weights,dtype=np.float32)

# smooth normals from the surface itself
norms=np.zeros_like(verts)
f=tris.reshape(-1,3)
fn=np.cross(verts[f[:,1]]-verts[f[:,0]], verts[f[:,2]]-verts[f[:,0]])
for i in range(3): np.add.at(norms,f[:,i],fn)
ln=np.linalg.norm(norms,axis=1,keepdims=True); ln[ln==0]=1
norms/=ln

# ================================================================ animation
def q(axis,deg):
    a=math.radians(deg)/2.0; s=math.sin(a)
    v=np.array(axis,dtype=float); v/=np.linalg.norm(v)
    return [round(float(v[0]*s),5),round(float(v[1]*s),5),round(float(v[2]*s),5),round(float(math.cos(a)),5)]
def qmul(a,b):
    ax,ay,az,aw=a; bx,by,bz,bw=b
    return [round(aw*bx+ax*bw+ay*bz-az*by,5),round(aw*by-ax*bz+ay*bw+az*bx,5),
            round(aw*bz+ax*by-ay*bx+az*bw,5),round(aw*bw-ax*bx-ay*by-az*bz,5)]
HIP_Y=J['Hips'][1]

# SIGN CONVENTION (limb bones point downward, -Y):
#   hip flexion (leg forward)  = NEGATIVE X
#   knee flexion (heel back)   = POSITIVE X   <-- was inverted in v1
#   elbow flexion (hand up)    = NEGATIVE X
def gait(n,dur,swing,kneeMax,armSwing,elbow,lean,bob,roll):
    times=[round(i*dur/n,4) for i in range(n+1)]
    K=[2*math.pi*i/n for i in range(n+1)]
    tr={}
    hipL=[-swing*math.sin(p) for p in K]
    hipR=[-swing*math.sin(p+math.pi) for p in K]
    knL =[ 5 + kneeMax*max(0,math.sin(p-1.25*math.pi)) for p in K]
    knR =[ 5 + kneeMax*max(0,math.sin(p+math.pi-1.25*math.pi)) for p in K]
    ftL =[-0.42*hipL[i]-0.55*knL[i] for i in range(n+1)]
    ftR =[-0.42*hipR[i]-0.55*knR[i] for i in range(n+1)]
    tr['LeftUpLeg']=[q((1,0,0),v) for v in hipL]
    tr['RightUpLeg']=[q((1,0,0),v) for v in hipR]
    tr['LeftLeg']=[q((1,0,0),v) for v in knL]
    tr['RightLeg']=[q((1,0,0),v) for v in knR]
    tr['LeftFoot']=[q((1,0,0),v) for v in ftL]
    tr['RightFoot']=[q((1,0,0),v) for v in ftR]
    # arms counter-swing the legs
    tr['LeftArm']=[qmul(q((0,0,1), 7),q((1,0,0), armSwing*math.sin(p))) for p in K]
    tr['RightArm']=[qmul(q((0,0,1),-7),q((1,0,0),-armSwing*math.sin(p))) for p in K]
    tr['LeftForeArm']=[q((1,0,0),-elbow-9*math.sin(p)) for p in K]
    tr['RightForeArm']=[q((1,0,0),-elbow+9*math.sin(p)) for p in K]
    tr['Spine']=[qmul(q((1,0,0),-lean*0.45),q((0,1,0), 4*math.sin(p))) for p in K]
    tr['Spine1']=[q((1,0,0),-lean*0.30) for p in K]
    tr['Spine2']=[qmul(q((1,0,0),-lean*0.25),q((0,1,0),-9*math.sin(p))) for p in K]
    tr['Neck']=[qmul(q((1,0,0),lean*0.75),q((0,1,0),4*math.sin(p))) for p in K]
    hipsT=[[0.0,round(HIP_Y-bob+bob*abs(math.cos(p)),4),0.0] for p in K]
    hipsR=[qmul(q((0,0,1),roll*math.sin(p)),q((0,1,0),-5*math.sin(p))) for p in K]
    return {'duration':times[-1],'times':times,'quat':tr,'hipsPos':hipsT,'hipsQuat':hipsR}

def idle(n=20,dur=4.4):
    times=[round(i*dur/n,4) for i in range(n+1)]
    K=[2*math.pi*i/n for i in range(n+1)]
    tr={}
    tr['Spine']=[q((1,0,0),-1.2+1.0*math.sin(k)) for k in K]
    tr['Spine2']=[q((0,1,0),1.6*math.sin(k*0.5)) for k in K]
    tr['Neck']=[q((0,1,0),3.2*math.sin(k*0.5)) for k in K]
    tr['LeftArm']=[qmul(q((0,0,1), 9),q((1,0,0),1.3*math.sin(k))) for k in K]
    tr['RightArm']=[qmul(q((0,0,1),-9),q((1,0,0),-1.3*math.sin(k))) for k in K]
    tr['LeftForeArm']=[q((1,0,0),-12) for _ in K]
    tr['RightForeArm']=[q((1,0,0),-12) for _ in K]
    tr['LeftUpLeg']=[q((1,0,0),-2) for _ in K]
    tr['RightUpLeg']=[q((1,0,0), 3) for _ in K]
    tr['LeftLeg']=[q((1,0,0),4) for _ in K]     # soft knees, correct direction
    tr['RightLeg']=[q((1,0,0),7) for _ in K]
    tr['LeftFoot']=[q((1,0,0),-2) for _ in K]
    tr['RightFoot']=[q((1,0,0),-4) for _ in K]
    hipsT=[[0.0,round(HIP_Y-0.006+0.004*math.sin(k),4),0.0] for k in K]
    hipsR=[q((0,0,1),1.4) for _ in K]
    return {'duration':times[-1],'times':times,'quat':tr,'hipsPos':hipsT,'hipsQuat':hipsR}

def crouch(n=12,dur=3.2):
    """Squat, reaching down with the right hand. Both knees flex correctly."""
    times=[round(i*dur/n,4) for i in range(n+1)]
    K=[2*math.pi*i/n for i in range(n+1)]
    tr={}
    tr['LeftUpLeg']=[q((1,0,0),-86) for _ in K]
    tr['RightUpLeg']=[q((1,0,0),-80) for _ in K]
    tr['LeftLeg']=[q((1,0,0),108) for _ in K]
    tr['RightLeg']=[q((1,0,0),102) for _ in K]
    tr['LeftFoot']=[q((1,0,0),-26) for _ in K]
    tr['RightFoot']=[q((1,0,0),-24) for _ in K]
    tr['Spine']=[q((1,0,0),-22-1.5*math.sin(k)) for k in K]
    tr['Spine1']=[q((1,0,0),-13) for _ in K]
    tr['Spine2']=[q((1,0,0),-10) for _ in K]
    tr['Neck']=[q((1,0,0),22) for _ in K]
    tr['RightArm']=[qmul(q((0,0,1),-14),q((1,0,0),-38-4*math.sin(k))) for k in K]
    tr['RightForeArm']=[q((1,0,0),-46) for _ in K]
    tr['LeftArm']=[qmul(q((0,0,1),13),q((1,0,0),-10)) for _ in K]
    tr['LeftForeArm']=[q((1,0,0),-30) for _ in K]
    hipsT=[[0.0,round(0.470+0.006*math.sin(k),4),0.0] for k in K]
    hipsR=[q((1,0,0),-7) for _ in K]
    return {'duration':times[-1],'times':times,'quat':tr,'hipsPos':hipsT,'hipsQuat':hipsR}

CLIPS={'idle':(idle(),0.0),
       'walk':(gait(24,1.00,36,44,20,14,2.5,0.028,3.5),2.05),
       'jog' :(gait(20,0.64,45,72,38,32,9.0,0.042,4.5),4.05),
       'crouch':(crouch(),0.0)}

local={}
for b in BONES:
    p=PARENT[b]
    local[b]=[round(float(x),5) for x in (np.array(J[b])-(np.array(J[p]) if p else np.zeros(3)))]

out={'bones':[{'name':b,'parent':PARENT[b],'pos':local[b]} for b in BONES],
     'rest':{b:[round(v,5) for v in J[b]] for b in BONES},
     'position':[round(float(v),4) for v in verts.flatten()],
     'normal':[round(float(v),3) for v in norms.flatten()],
     'index':tris.tolist(),
     'skinIndex':joints.flatten().tolist(),
     'skinWeight':[round(float(v),3) for v in weights.flatten()],
     'clips':{k:v[0] for k,v in CLIPS.items()},
     'speeds':{k:v[1] for k,v in CLIPS.items()}}
json.dump(out,open('human3.json','w'),separators=(',',':'))
import os
print('verts',len(verts),'tris',len(tris)//3,'json',os.path.getsize('human3.json')//1024,'KB')
