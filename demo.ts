import { IRecorderOptions } from "./index.js";
import { HLSRecorder, ISegments } from "./index";

const rec_opts: IRecorderOptions = {
  recordDuration: 120,
  windowSize: -1,
  vod: true,
};

const LIVE_URI = "http://localhost:8000/channels/1/master.m3u8";
const LIVE_URI2 =
  "https://bitdash-a.akamaihd.net/content/MI201109210084_1/m3u8s-fmp4/f08e80da-bf1d-4e3d-8899-f0f6155f6efa.m3u8";
const recorder = new HLSRecorder(LIVE_URI2, rec_opts);

recorder.on(
  "mseq-increment",
  async (data: { allPlaylistSegments: ISegments }) => {
    const varaints = Object.keys(data.allPlaylistSegments["video"]);
    const level0 = varaints[0];
    console.log(
      `We got something: ${JSON.stringify(
        data.allPlaylistSegments["video"][level0],
        null,
        2
      )}`
    );
  }
);
recorder.on("error", (err: any) => {
  console.log(`ERROR -> ${JSON.stringify(err)}`);
  throw new Error("Something Bad Happend (>.<)");
});

const run = async () => {
  recorder.start();
  recorder.listen(1377);
};
/**********************
 * Run Driver function
 *********************/
run();
