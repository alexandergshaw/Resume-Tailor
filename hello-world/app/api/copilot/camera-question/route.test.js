import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),ocr:vi.fn()}));
vi.mock("@/lib/experience/apiAuth",()=>({getAuth:mocks.auth,unauthorized:()=>Response.json({error:"Unauthorized"},{status:401})}));
vi.mock("@/lib/scrape/screenshotOcr",()=>({ocrImage:mocks.ocr}));
let POST;
function png(width=100,height=100){const a=new Uint8Array(33);a.set([137,80,78,71,13,10,26,10]);const v=new DataView(a.buffer);v.setUint32(8,13);v.setUint32(12,0x49484452);v.setUint32(16,width);v.setUint32(20,height);return a;}
function request(bytes=png(),headers={}){return new Request("https://example.test/api/copilot/camera-question",{method:"POST",headers:{"content-type":"image/png",...headers},body:bytes});}
beforeEach(async()=>{vi.resetModules();mocks.auth.mockReset().mockResolvedValue({userId:"camera-user"});mocks.ocr.mockReset().mockResolvedValue("What did you build?");({POST}=await import("./route"));});
afterEach(()=>vi.useRealTimers());
describe("bounded authenticated camera OCR",()=>{
  it("authenticates before body or OCR",async()=>{mocks.auth.mockResolvedValue({userId:null});const req={get body(){throw Error("body accessed");}};expect((await POST(req)).status).toBe(401);expect(mocks.ocr).not.toHaveBeenCalled();});
  it("rejects unsupported, oversized streamed bytes, lying length and invalid dimensions before OCR",async()=>{
    expect((await POST(request(png(),{"content-type":"image/jpeg"}))).status).toBe(415);
    expect((await POST(request(new Uint8Array(2097153),{"content-length":"1"}))).status).toBe(413);
    expect((await POST(request(png(1601,1)))).status).toBe(422);
    expect((await POST(request(new Uint8Array(33)))).status).toBe(422);expect(mocks.ocr).not.toHaveBeenCalled();
  });
  it("returns only editable text and bounds unreadable/long/decoder-failure outputs",async()=>{
    expect(await (await POST(request())).json()).toEqual({text:"What did you build?"});
    mocks.ocr.mockResolvedValue(" ");expect((await POST(request())).status).toBe(422);
    mocks.ocr.mockResolvedValue("a".repeat(12001));expect((await POST(request())).status).toBe(422);
    mocks.ocr.mockRejectedValue(Error("private decoder details"));const result=await POST(request());expect(result.status).toBe(422);expect(JSON.stringify(await result.json())).not.toContain("private");
  });
  it("counts ten authenticated attempts at module scope",async()=>{for(let i=0;i<10;i++)expect((await POST(request())).status).toBe(200);expect((await POST(request())).status).toBe(429);expect(mocks.ocr).toHaveBeenCalledTimes(10);});
  it("holds the busy slot after response timeout until actual OCR settles, then recovers",async()=>{
    vi.useFakeTimers();let finish;mocks.ocr.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const first=POST(request());await vi.advanceTimersByTimeAsync(1);
    expect((await POST(request())).status).toBe(503);await vi.advanceTimersByTimeAsync(20000);expect((await first).status).toBe(504);
    expect((await POST(request())).status).toBe(503);expect(mocks.ocr).toHaveBeenCalledTimes(1);
    finish("Resolved old question");await vi.advanceTimersByTimeAsync(0);expect((await POST(request())).status).toBe(200);
  });
  it("handles late OCR rejection and frees admission without terminating shared worker",async()=>{
    vi.useFakeTimers();let fail;mocks.ocr.mockImplementationOnce(()=>new Promise((_,reject)=>{fail=reject;}));const first=POST(request());await vi.advanceTimersByTimeAsync(20001);expect((await first).status).toBe(504);fail(Error("late"));await vi.advanceTimersByTimeAsync(0);expect((await POST(request())).status).toBe(200);
  });
});
