import { IRecorderOptions } from "./index.js";
import { HLSRecorder, ISegments } from "./index";
// import restify from "restify";

const timer = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Me
const URI1 = "http://localhost:1377/live/master.m3u8";
// With PROGRAM-DATE-TIME live live
const URI2 =
  "https://cbsn-us.cbsnstream.cbsnews.com/out/v1/55a8648e8f134e82a470f83d562deeca/master.m3u8";
// With MAP vod
const URI3 = "https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8";
// With KEY vod
const URI4 = "https://playertest.longtailvideo.com/adaptive/aes-with-tracks/master.m3u8";
// With MAP vod all m4s
const URI5 =
  "https://bitdash-a.akamaihd.net/content/MI201109210084_1/m3u8s-fmp4/f08e80da-bf1d-4e3d-8899-f0f6155f6efa.m3u8";
// With Channel Engine
const URI6 = "https://demo.vc.eyevinn.technology/channels/eyevinn/master.m3u8";
// With 24/7 Live Tears Of Steel
const URI7 = "https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8";
// short-multi stream (demuxed & subtitles) 18 seconds
const URI8 = "https://lab-live.cdn.eyevinn.technology/ED_V4/master.m3u8";

const rec_opts: IRecorderOptions = {
  recordDuration: 180,
  windowSize: -1, // -1 for infinite* (max cap defaults at 30 000 seconds/5 minutes if source is a live manifest. To overwrite the max cap, just specify a windowsize.)
  vod: true,
};
const recorder = new HLSRecorder(URI2, rec_opts);
recorder.on("mseq-increment", async (data: { allPlaylistSegments: ISegments }) => {
  const variants = Object.keys(data.allPlaylistSegments["video"]);
  const level0 = variants[0];
  console.log(
    `Recorded Segments: ${JSON.stringify(data.allPlaylistSegments["video"][level0], null, 2)}`
  );
});
recorder.on("error", (err: any) => {
  console.log(`ERROR -> ${JSON.stringify(err)}`);
  throw new Error("Something Bad Happend (>.<)");
});

const run = async () => {
  recorder.start();
  /* (!) Be sure to have 'restify' imported first */
  //recorder.setRestifyServer(restify);
  //recorder.listen(1377); // Playback at "http://localhost:1377/live/master.m3u8"
};
/**********************
 * Run Driver function
 *********************/
run();
