import { IRecorderOptions } from "./index.js";
import { HLSRecorder, ISegments } from "./index";
import path from "path/posix";

const rec_opts: IRecorderOptions = {
  recordDuration: -1,
  windowSize: -1,
  vod: true,
};
const timer = (ms: number) => new Promise((res) => setTimeout(res, ms));
const URI_1 = "http://localhost:8000/channels/1/master.m3u8";
const URI_2 = "https://lab-live.cdn.eyevinn.technology/MINI_NOONLIGHT_TEST/master.m3u8";
//"https://24a2f640-0a5f-11e7-b9a0-13c9abe93ad7.relay-int.solink.direct/alarm/ue99c8t7QOowTNTHnlAHNQ/cameras/IuYkcLBtvnB6tf40/alarm.m3u8?stream=d2e1822f-59a0-441a-b1de-05040bcc8ac9&start=1636042140000&startPlayback=1636042140000&vtt=true&jwt=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkMjdhNGE5YS00OTVkLTQwOGQtYTJlYS00MWVmMjFlMTY1YTMiLCJuYW1lIjoiQWxhcm1zIiwiZW1haWwiOiJ0ZW1wb3JhcnlAc29saW5rY29ycC5jb20iLCJ0ZW5hbnRJZCI6ImEzYTU1ZTMwLWRjYTAtMTFlNS04MjU2LWI1ZjczNDQ5NDYyNSIsInVzZXJUeXBlIjoic3RhbmRhcmQiLCJyb2xlcyI6WyJTdGFuZGFyZCJdLCJhcHBfbWV0YWRhdGEiOnsicm9sZXMiOlsiU3RhbmRhcmQiXSwiY2xvdWRJZCI6ImM4NWJhYzMwLWRjOWYtMTFlNS04ODkzLWVkNWJkNDRlNzlmMiIsInJlc2VsbGVySWQiOiI4Y2MzZDJmMC1kY2EwLTExZTUtODI1Ni1iNWY3MzQ0OTQ2MjUiLCJjdXN0b21lcklkIjoiYTNhNTVlMzAtZGNhMC0xMWU1LTgyNTYtYjVmNzM0NDk0NjI1IiwidGVuYW50SWQiOiJhM2E1NWUzMC1kY2EwLTExZTUtODI1Ni1iNWY3MzQ0OTQ2MjUiLCJsb2NhdGlvbnMiOlsiMjRhMmY2NDAtMGE1Zi0xMWU3LWI5YTAtMTNjOWFiZTkzYWQ3Il0sInVzZXJUeXBlIjoic3RhbmRhcmQiLCJpZGVudGl0eVR5cGUiOiJURU1QT1JBUllfQUNDRVNTIn0sInVzZXJfbWV0YWRhdGEiOnt9LCJzY29wZSI6eyJ2IjoxLCJyIjpbeyJ1IjoiL2NhbWVyYXMvSXVZa2NMQnR2bkI2dGY0MC8oYWxhcm18dGltZXN0YW1wKS5tM3U4IiwicCI6eyJzdHJlYW0iOiJkMmUxODIyZi01OWEwLTQ0MWEtYjFkZS0wNTA0MGJjYzhhYzkiLCJzdGFydCI6IjE2MzYwNDIxNDAwMDAiLCI_c3RhcnRQbGF5YmFjayI6Ii4rIiwiP3Z0dCI6Ii4rIiwiP2Nsb3NlZCI6Ii4rIn19LHsidSI6Ii9jYW1lcmFzL0l1WWtjTEJ0dm5CNnRmNDAvbGl2ZS5tM3U4IiwicCI6eyJzdHJlYW0iOiJkMmUxODIyZi01OWEwLTQ0MWEtYjFkZS0wNTA0MGJjYzhhYzkiLCJleHAiOiIxNjM2MDQ5MzQ1ODM0In19LHsidSI6Ii9jYW1lcmFzL0l1WWtjTEJ0dm5CNnRmNDAvdHMvLioudHMiLCJwIjp7fX0seyJ1IjoiL2NhbWVyYXMvSXVZa2NMQnR2bkI2dGY0MC92dHQvZDJlMTgyMmYtNTlhMC00NDFhLWIxZGUtMDUwNDBiY2M4YWM5Ly4qLndlYnZ0dCIsInAiOnt9fV19LCJpYXQiOjE2MzYwNDIxNDgsImV4cCI6MTYzNjEyODU0OCwiaXNzIjoiaHR0cHM6Ly9pbnQuc29saW5rY2xvdWQuY29tLyJ9.jfGXyGo8EGpRh85Z9GDjHPEybE33t7qsOxZ75sLHydOZa1mPRLdjftPeuGUKDGMcJwSm7LdJdi0I0O9MGgTgvY_AggDMSgzuzQERnqt5Wc1dPn68zPOksJ-DVofYauH18S3fpvhAYmzVv6wHEpq_WTHcTxPpFJTxGor8yUSHpr3jJL8AwRStYZnXTONRvJCFwZu3bF6izOShA2hWnbShakv8vFBwmVFng0OiCVvglGNNGsUGD1kQcBgDg-0bn2eCb8lnkj5q0DmfVxb2At-PeqAGlNPm0H-N7maYKsQKKS6ojD5awgTeqyN_6EmC4GxtnbIarHDVYK06ymNcjWNhhw&withCredentials=true&exp=1636049345834";
const recorder_ce = new HLSRecorder(URI_2, {
  recordDuration: 120,
  windowSize: -1,
  vod: true,
});
const recorder_r = new HLSRecorder(URI_2, rec_opts);

let prevMseq = 0;
recorder_r.on(
  "mseq-increment",
  async (data: { allPlaylistSegments: ISegments }) => {
    let newSegs = GetOnlyNewestSegments(data.allPlaylistSegments, prevMseq);
    console.log(`RECORDER.ON EVENT: ${JSON.stringify(newSegs, null, 2)}`);
  }
);
// recorder.on("error", (data) => {
//   console.log(`RECORDER.ON:ERROR -> ${JSON.stringify(data)}`);
// });

const run = async () => {
  recorder_ce.start();
  recorder_ce.listen(8880);
  //   await timer(3000);
  //   recorder_r.start();

  await timer(60 * 2 * 1000);
  //recorder_r.stop();
  let tt = path.basename(
    "https://24a2f640-0a5f-11e7-b9a0-13c9abe93ad7.relay-int.solink.direct/alarm/ue99c8t7QOowTNTHnlAHNQ/cameras/IuYkcLBtvnB6tf40/alarm.m3u8?startPlayback=1636042140000&stream=d2e1822f-59a0-441a-b1de-05040bcc8ac9&start=1636042140000&discontinuityTag=truets/d2e1822f-59a0-441a-b1de-05040bcc8ac9/1636043085754_16585.ts"
  );
  console.log("TT", tt);
};
/**********************
 * Run Driver function
 *********************/
run();

//********************/
// Helper Functions
//********************/
function GetOnlyNewestSegments(
  Segments: ISegments,
  prevMediaSeq: number
): ISegments {
  let lastSegments: ISegments = {
    video: {},
    audio: {},
    subtitle: {},
  };
  const Bandwidths = Object.keys(Segments["video"]);
  const newMseq = Segments["video"][Bandwidths[0]].mediaSeq;
  const mseqDiff = newMseq - prevMediaSeq;
  const sliceOffset = mseqDiff < 0 ? 0 : mseqDiff;
  Bandwidths.forEach((bw: string) => {
    lastSegments["video"][bw] = {
      mediaSeq: -1,
      segList: [],
    };
    lastSegments["video"][bw].mediaSeq = Segments["video"][bw].mediaSeq;
    lastSegments["video"][bw].segList = Segments["video"][bw].segList.slice(
      -1 * sliceOffset
    );
  });

  for (let i = 0; i < Object.keys(Segments["audio"]).length; i++) {
    let group = Object.keys(Segments["audio"])[i];
    lastSegments["audio"][group] = {};
    Object.keys(Segments["audio"][group]).forEach((lang) => {
      lastSegments["audio"][group][lang] = {
        mediaSeq: -1,
        segList: [],
      };
      lastSegments["audio"][group][lang].mediaSeq =
        Segments["audio"][group][lang].mediaSeq;

      lastSegments["audio"][group][lang].segList = Segments["audio"][group][
        lang
      ].segList.slice(-1 * sliceOffset);
    });
  }
  return lastSegments;
}
