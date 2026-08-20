import json, struct, numpy as np, base64
from pygltflib import (GLTF2, Scene, Node, Mesh, Primitive, Attributes, Buffer,
                       BufferView, Accessor, Skin, Animation, AnimationSampler,
                       AnimationChannel, AnimationChannelTarget, Asset)

d = json.load(open('human3.json'))
bones = d['bones']
names = [b['name'] for b in bones]
NI = {n:i for i,n in enumerate(names)}

blob = bytearray()
views, accs = [], []

def pad4():
    while len(blob) % 4: blob.append(0)

def push(arr, dtype, comp_type, typ, target=None, minmax=False):
    pad4()
    a = np.asarray(arr, dtype=dtype)
    off = len(blob); blob.extend(a.tobytes())
    views.append(BufferView(buffer=0, byteOffset=off, byteLength=len(a.tobytes()),
                            target=target))
    n = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[typ]
    acc = Accessor(bufferView=len(views)-1, componentType=comp_type,
                   count=len(a)//n, type=typ)
    if minmax:
        r = a.reshape(-1, n)
        acc.min = r.min(axis=0).tolist(); acc.max = r.max(axis=0).tolist()
    accs.append(acc)
    return len(accs)-1

FLOAT, U16, U8 = 5126, 5123, 5121
ARRAY_BUF, ELEM_BUF = 34962, 34963

a_pos = push(d['position'], np.float32, FLOAT, 'VEC3', ARRAY_BUF, minmax=True)
a_nrm = push(d['normal'],   np.float32, FLOAT, 'VEC3', ARRAY_BUF)
a_idx = push(d['index'],    np.uint16,  U16,   'SCALAR', ELEM_BUF)
a_jnt = push(d['skinIndex'],np.uint16,  U16,   'VEC4', ARRAY_BUF)
a_wgt = push(d['skinWeight'],np.float32,FLOAT, 'VEC4', ARRAY_BUF)

# inverse bind matrices: inverse of each bone's rest world transform (translation only)
ibm = []
for b in bones:
    p = d['rest'][b['name']]
    m = np.eye(4, dtype=np.float32)
    m[3,0], m[3,1], m[3,2] = -p[0], -p[1], -p[2]   # column-major, gltf order
    ibm.append(m.flatten())
a_ibm = push(np.concatenate(ibm), np.float32, FLOAT, 'MAT4')

# ---- nodes: bones first, then the skinned mesh
nodes = []
for b in bones:
    nodes.append(Node(name=b['name'], translation=[float(x) for x in b['pos']],
                      rotation=[0,0,0,1], children=[]))
for i, b in enumerate(bones):
    if b['parent']: nodes[NI[b['parent']]].children.append(i)

mesh_node = len(nodes)
nodes.append(Node(name='Body', mesh=0, skin=0))

prim = Primitive(attributes=Attributes(POSITION=a_pos, NORMAL=a_nrm,
                                       JOINTS_0=a_jnt, WEIGHTS_0=a_wgt),
                 indices=a_idx, mode=4)

# ---- animations
anims = []
for cname, c in d['clips'].items():
    samplers, channels = [], []
    a_time = push(c['times'], np.float32, FLOAT, 'SCALAR', minmax=True)
    for bone, quats in c['quat'].items():
        a_out = push(np.array(quats, dtype=np.float32).flatten(), np.float32, FLOAT, 'VEC4')
        samplers.append(AnimationSampler(input=a_time, output=a_out, interpolation='LINEAR'))
        channels.append(AnimationChannel(sampler=len(samplers)-1,
            target=AnimationChannelTarget(node=NI[bone], path='rotation')))
    a_hp = push(np.array(c['hipsPos'], dtype=np.float32).flatten(), np.float32, FLOAT, 'VEC3')
    samplers.append(AnimationSampler(input=a_time, output=a_hp, interpolation='LINEAR'))
    channels.append(AnimationChannel(sampler=len(samplers)-1,
        target=AnimationChannelTarget(node=NI['Hips'], path='translation')))
    a_hq = push(np.array(c['hipsQuat'], dtype=np.float32).flatten(), np.float32, FLOAT, 'VEC4')
    samplers.append(AnimationSampler(input=a_time, output=a_hq, interpolation='LINEAR'))
    channels.append(AnimationChannel(sampler=len(samplers)-1,
        target=AnimationChannelTarget(node=NI['Hips'], path='rotation')))
    anims.append(Animation(name=cname, samplers=samplers, channels=channels))

pad4()
g = GLTF2(
    asset=Asset(version='2.0', generator='The File — procedural humanoid'),
    scene=0, scenes=[Scene(nodes=[0, mesh_node])],
    nodes=nodes, meshes=[Mesh(primitives=[prim])],
    skins=[Skin(inverseBindMatrices=a_ibm, joints=list(range(len(bones))), skeleton=0)],
    animations=anims, accessors=accs, bufferViews=views,
    buffers=[Buffer(byteLength=len(blob))]
)
g.set_binary_blob(bytes(blob))
g.save_binary('sokolov.glb')
print('GLB written:', len(blob), 'bytes of buffer')
