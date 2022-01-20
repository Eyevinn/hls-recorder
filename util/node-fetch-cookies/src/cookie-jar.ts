import { promises as fs } from "fs";
import url from "url";
import Cookie from "./cookie";
import { paramError, CookieParseError } from "./errors";

export default class CookieJar {
  flags: any;
  cookies: any;
  file: any;
  cookieIgnoreCallback: any;
  constructor(
    file?: any,
    flags = "rw",
    cookies?: any,
    cookieIgnoreCallback?: any
  ) {
    this.cookies = new Map();
    if (file && typeof file !== "string")
      throw paramError("Second", "file", "new CookieJar()", "string");
    if (typeof flags !== "string")
      throw paramError("First", "flags", "new CookieJar()", "string");
    if (Array.isArray(cookies)) {
      if (!cookies.every((c) => c instanceof Cookie))
        throw paramError("Third", "cookies", "new CookieJar()", "[Cookie]");
      cookies.forEach((cookie) => this.addCookie(cookie));
    } else if (cookies instanceof Cookie) this.addCookie(cookies);
    else if (cookies)
      throw paramError("Third", "cookies", "new CookieJar()", [
        "[Cookie]",
        "Cookie",
      ]);
    if (cookieIgnoreCallback && typeof cookieIgnoreCallback !== "function")
      throw paramError(
        "Fourth",
        "cookieIgnoreCallback",
        "new CookieJar()",
        "function"
      );
    this.file = file;
    this.flags = flags;
    this.cookieIgnoreCallback = cookieIgnoreCallback;
  }
  addCookie(_cookie: any, fromURL?: string | undefined) {
    if (typeof _cookie === "string") {
      try {
        _cookie = new Cookie(_cookie, fromURL);
      } catch (error) {
        if (error instanceof CookieParseError) {
          if (this.cookieIgnoreCallback)
            this.cookieIgnoreCallback(_cookie, error.message);
          return false;
        }
        throw error;
      }
    } else if (!(_cookie instanceof Cookie))
      throw paramError("First", "cookie", "CookieJar.addCookie()", [
        "string",
        "Cookie",
      ]);
    if (!this.cookies.has(_cookie.domain))
      this.cookies.set(_cookie.domain, new Map());
    this.cookies.get(_cookie.domain).set(_cookie.name, _cookie);
    return true;
  }
  domains() {
    return this.cookies.keys();
  }
  *cookiesDomain(domain: string) {
    for (const cookie of (this.cookies.get(domain) || []).values())
      yield cookie;
  }
  *cookiesValid(withSession: boolean) {
    for (const cookie of this.cookiesAll())
      if (!cookie.hasExpired(!withSession)) yield cookie;
  }
  *cookiesAll() {
    for (const domain of this.domains()) yield* this.cookiesDomain(domain);
  }
  *cookiesValidForRequest(requestURL: string) {
    const namesYielded = new Set();
    let domains: string[] = [];
    let parsed = url.parse(requestURL);
    if (parsed.hostname !== null) {
        domains = parsed.hostname.split(".")
        .map((_, i, a) => a.slice(i).join("."));
    }
    for (const domain of domains) {
      for (const cookie of this.cookiesDomain(domain)) {
        if (
          cookie.isValidForRequest(requestURL) &&
          !namesYielded.has(cookie.name)
        ) {
          namesYielded.add(cookie.name);
          yield cookie;
        }
      }
    }
  }
  deleteExpired(sessionEnded: any) {
    const validCookies = [...this.cookiesValid(!sessionEnded)];
    this.cookies = new Map();
    validCookies.forEach((c) => this.addCookie(c));
  }
}
