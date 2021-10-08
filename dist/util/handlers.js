"use strict";
// TODO: Write endpoint handler functions that generate the requested type of manifest...
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports._handleAudioManifest = exports._handleMediaManifest = exports._handleMasterManifest = void 0;
const debug = require("debug")("recorder");
const manifest_generator_1 = require("./manifest_generator");
function _handleMasterManifest(req, res, next, masterM3u) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const body = masterM3u;
            res.sendRaw(200, Buffer.from(body, "utf8"), {
                "Content-Type": "application/x-mpegURL;charset=UTF-8",
                "Access-Control-Allow-Origin": "*",
            });
            next();
        }
        catch (err) {
            next(console.error(err));
        }
    });
}
exports._handleMasterManifest = _handleMasterManifest;
function _handleMediaManifest(req, res, next, recData) {
    return __awaiter(this, void 0, void 0, function* () {
        debug(`req.url=${req.url}`);
        try {
            let body = null;
            debug(`Responding with dvr media manifest`);
            body = yield (0, manifest_generator_1.GenerateMediaM3U8)(req.params[0], recData.mseq, recData.targetDuration, recData.allSegments);
            if (body !== null) {
                res.sendRaw(200, Buffer.from(body, "utf8"), {
                    "Content-Type": "application/x-mpegURL;charset=UTF-8",
                    "Access-Control-Allow-Origin": "*",
                });
            }
            next();
        }
        catch (err) {
            next(console.error(err));
        }
    });
}
exports._handleMediaManifest = _handleMediaManifest;
function _handleAudioManifest(req, res, next) {
    // TODO .....
}
exports._handleAudioManifest = _handleAudioManifest;
//# sourceMappingURL=handlers.js.map