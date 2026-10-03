/**
 * The Google desktop client built into the installer (D37): testers sign in without making a Google
 * Cloud project. scripts/build.mjs fills this in from app/build-secrets/google-client.json, which is
 * git-ignored, so it is never in the repository. A google-client.json in the data folder still wins.
 */
import { runtime } from "../../src/runtime.js";

declare const __EDWARD_GOOGLE_CLIENT__: { clientId: string; clientSecret: string } | null;

if (__EDWARD_GOOGLE_CLIENT__) runtime.googleClient = __EDWARD_GOOGLE_CLIENT__;
