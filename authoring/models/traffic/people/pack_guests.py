"""Repack exported passenger colour and joint-weight attributes for WebGL."""
import json
import struct


def pack(path):
    data=path.read_bytes()
    json_size=struct.unpack_from("<I",data,12)[0]
    doc=json.loads(data[20:20+json_size])
    raw=data[28+json_size:]
    attrs=doc["meshes"][0]["primitives"][0]["attributes"]
    replacements={}
    for key in ("COLOR_0","WEIGHTS_0","NORMAL"):
        accessor=doc["accessors"][attrs[key]]
        assert accessor["componentType"]==5126 and not accessor.get("byteOffset",0)
        view_id=accessor["bufferView"];view=doc["bufferViews"][view_id]
        columns=3 if accessor["type"]=="VEC3" else 4
        src=raw[view.get("byteOffset",0):][:view["byteLength"]]
        rows=list(struct.iter_unpack("<"+"f"*columns,src))
        assert len(rows)==accessor["count"]
        packed=bytearray()
        for row in rows:
            if key=="COLOR_0":
                rgba=(*row,1) if columns==3 else row
                packed.extend(struct.pack("<4H",*[round(min(1,max(0,v))*65535) for v in rgba]))
            elif key=="WEIGHTS_0":
                assert len(row)==4 and abs(sum(row)-1)<.0001
                q=[round(max(0,v)*255) for v in row]
                q[max(range(4),key=row.__getitem__)]+=255-sum(q)
                assert sum(q)==255 and min(q)>=0
                packed.extend(bytes(q))
            else:
                packed.extend(struct.pack("<4h",*[round(max(-1,min(1,v))*32767) for v in row],0))
        accessor["normalized"]=True
        accessor["type"]="VEC3" if key=="NORMAL" else "VEC4"
        accessor["componentType"]={"NORMAL":5122,"COLOR_0":5123,"WEIGHTS_0":5121}[key]
        if key=="NORMAL":view["byteStride"]=8
        accessor.pop("min",None);accessor.pop("max",None)
        replacements[view_id]=packed
    packed=bytearray()
    for i,view in enumerate(doc["bufferViews"]):
        start=view.get("byteOffset",0);value=replacements.get(i,raw[start:start+view["byteLength"]])
        packed.extend(b'\0'*(-len(packed)%4));view["byteOffset"]=len(packed)
        view["byteLength"]=len(value);packed.extend(value)
    doc["buffers"][0]["byteLength"]=len(packed)
    for key in ("extensionsUsed","extensionsRequired"):
        doc[key]=sorted(set(doc.get(key,[]))|{"KHR_mesh_quantization"})
    packed.extend(b'\0'*(-len(packed)%4))
    encoded=json.dumps(doc,ensure_ascii=False,separators=(',',':')).encode("utf8")
    encoded+=b' '*(-len(encoded)%4)
    path.write_bytes(struct.pack("<4sII",b'glTF',2,28+len(encoded)+len(packed))+
                     struct.pack("<I4s",len(encoded),b'JSON')+encoded+
                     struct.pack("<I4s",len(packed),b'BIN\0')+packed)

