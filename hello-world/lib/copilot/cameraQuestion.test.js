import { describe, it, expect, vi, afterEach } from "vitest";
import { validCameraPng, MAX_CAMERA_BYTES, captureCameraFrame, readCameraFrame } from "./cameraQuestion";
function png(width = 1600, height = 1200) {
  const bytes = new Uint8Array(33); bytes.set([137,80,78,71,13,10,26,10]);
  const view = new DataView(bytes.buffer); view.setUint32(8,13); view.setUint32(12,0x49484452); view.setUint32(16,width); view.setUint32(20,height); return bytes;
}
afterEach(() => vi.unstubAllGlobals());
describe("camera image bounds", () => {
  it("accepts exact dimension boundary and rejects corrupt, empty, oversized and excessive dimension headers", () => {
    expect(validCameraPng(png())).toBe(true);
    for (const bytes of [png(1601,1200),png(1600,1201),png(0,1),new Uint8Array(33),new Uint8Array(MAX_CAMERA_BYTES+1),new Uint8Array()]) expect(validCameraPng(bytes)).toBe(false);
    const wrongChunk=png(); wrongChunk[12]=0; expect(validCameraPng(wrongChunk)).toBe(false);
  });
  it("requires actual ready dimensions and captures one original frame scaled within limits", async () => {
    await expect(captureCameraFrame({readyState:1})).rejects.toThrow("not ready");
    const drawImage=vi.fn(), canvas={getContext:()=>({drawImage}),toBlob:(done,type)=>{expect(type).toBe("image/png");done({size:100});}};
    vi.stubGlobal("document",{createElement:()=>canvas});
    const video={readyState:2,videoWidth:3200,videoHeight:2400};
    await captureCameraFrame(video); expect(canvas.width).toBe(1600);expect(canvas.height).toBe(1200);expect(drawImage).toHaveBeenCalledExactlyOnceWith(video,0,0,1600,1200);
    canvas.toBlob=(done)=>done({size:MAX_CAMERA_BYTES+1});await expect(captureCameraFrame(video)).rejects.toThrow("too large");
  });
  it("sends one raw image and forwards meaningful server failure without accepting empty output", async () => {
    const fetch=vi.fn(async()=>({ok:true,json:async()=>({text:" Question? "})}));vi.stubGlobal("fetch",fetch);
    const blob={size:4}; expect(await readCameraFrame(blob)).toBe("Question?"); expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][1]).toMatchObject({method:"POST",body:blob,headers:{"Content-Type":"image/png"}});
    fetch.mockResolvedValue({ok:false,json:async()=>({error:"Camera reader is busy"})});await expect(readCameraFrame(blob)).rejects.toThrow("busy");
    fetch.mockResolvedValue({ok:true,json:async()=>({text:" "})});await expect(readCameraFrame(blob)).rejects.toThrow("No readable");
  });
});
