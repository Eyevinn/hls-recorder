// TODO: Write endpoint handler functions that generate the requested type of manifest...

const debug = require("debug")("hls-recorder");
const url = require("url");
import { ISegments } from "..";
import { GenerateMediaM3U8, GenerateAudioM3U8 } from "./manifest_generator";

export interface IRecData {
  mseq: number;
  dseq?: number;
  targetDuration: number;
  allSegments: ISegments;
}

export async function _handleMasterManifest(
  req: any,
  res: any,
  next: any,
  masterM3u: string
) {
  try {
    const body = masterM3u;
    res.sendRaw(200, Buffer.from(body, "utf8"), {
      "Content-Type": "application/x-mpegURL;charset=UTF-8",
      "Access-Control-Allow-Origin": "*",
    });
    next();
  } catch (err) {
    next(console.error(err));
  }
}

export async function _handleMediaManifest(
  req: any,
  res: any,
  next: any,
  recData: IRecData
) {
  debug(`req.url=${req.url}`);
  try {
    let body = null;
    debug(`Responding with dvr media manifest`);
    body = await GenerateMediaM3U8(req.params[0], recData);
    if (body !== null) {
      res.sendRaw(200, Buffer.from(body, "utf8"), {
        "Content-Type": "application/x-mpegURL;charset=UTF-8",
        "Access-Control-Allow-Origin": "*",
      });
    }
    next();
  } catch (err) {
    next(console.error(err));
  }
}

export async function _handleAudioManifest(
  req: any,
  res: any,
  next: any,
  recData: IRecData
) {
  debug(`req.url=${req.url}`);
  try {
    let body = null;
    debug(`Responding with dvr media manifest`);
    body = await GenerateAudioM3U8(req.params[0], req.params[1], recData);
    if (body !== null) {
      res.sendRaw(200, Buffer.from(body, "utf8"), {
        "Content-Type": "application/x-mpegURL;charset=UTF-8",
        "Access-Control-Allow-Origin": "*",
      });
    }
    next();
  } catch (err) {
    next(console.error(err));
  }
}
