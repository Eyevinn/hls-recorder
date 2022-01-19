const nodeFetch = require("node-fetch");
import CookieJar from "./cookie-jar";
import Cookie from "./cookie";
import {paramError, CookieParseError} from "./errors";

const {isRedirect} = nodeFetch;

async function fetch(cookieJars: CookieJar, url: string, options: any): Promise<any> {
    let cookies: string = "";
    const addValidFromJars = (jars: any[]) => {
        // since multiple cookie jars can be passed, filter duplicates by using a set of cookie names
        const set = new Set();
        jars.flatMap(jar => [...jar.cookiesValidForRequest(url)]).forEach(
            cookie => {
                if (set.has(cookie.name)) return;
                set.add(cookie.name);
                cookies += cookie.serialize() + "; ";
            }
        );
    };
    if (cookieJars) {
        if (
            Array.isArray(cookieJars) &&
            cookieJars.every(c => c instanceof CookieJar)
        )
            addValidFromJars(cookieJars.filter(jar => jar.flags.includes("r")));
        else if (cookieJars instanceof CookieJar)
            if (cookieJars.flags.includes("r")) addValidFromJars([cookieJars]);
            else
                throw paramError("First", "cookieJars", "fetch", [
                    "CookieJar",
                    "[CookieJar]"
                ]);
    }

    const wantFollow =
        !options || !options.redirect || options.redirect === "follow";
    if (!options) {
        if (cookies || wantFollow) options = {};
    }
    // shallow copy so we don't modify the original options object
    else options = {...options};
    if (
        options.follow !== undefined &&
        (!Number.isSafeInteger(options.follow) || options.follow < 0)
    )
        throw new TypeError("options.follow is not a safe positive integer");
    if (cookies) {
        if (options.headers instanceof nodeFetch.Headers) {
            // copy Headers as well so we don't modify it
            options.headers = new nodeFetch.Headers(options.headers);
            options.headers.append("cookie", cookies.slice(0, -2));
        } else
            options.headers = {
                ...(options.headers || {}),
                ...{cookie: cookies.slice(0, -2)}
            };
    }
    if (wantFollow) options.redirect = "manual";
    const result = await nodeFetch(url, options);
    // I cannot use headers.get() here because it joins the cookies to a string
    let newcookies: string[] = result.headers.raw()["set-cookie"];

    if (newcookies && cookieJars) {
        if (Array.isArray(cookieJars)) {
            cookieJars
                .filter(jar => jar.flags.includes("w"))
                .forEach(jar => newcookies.forEach(c => jar.addCookie(c, url)));
        } else if (
            cookieJars instanceof CookieJar &&
            cookieJars.flags.includes("w")
        )
        newcookies.forEach(c => cookieJars.addCookie(c, url));
    }
    if (wantFollow && isRedirect(result.status)) {
        if (options.follow !== undefined && --options.follow < 0)
            throw new nodeFetch.FetchError(
                "maximum redirect reached at: " + url,
                "max-redirect"
            );
        const location = result.headers.get("location");
        options.redirect = "follow";
        return fetch(cookieJars, location, options);
    }
    return result;
}

export default fetch;

export {
    fetch,
    CookieJar,
    Cookie,
    CookieParseError,
    nodeFetch,
    isRedirect
};
