import { describe, it, expect } from "vitest";
import { buildGreenhouseSearchUrl } from "./searchUrl.js";

describe("buildGreenhouseSearchUrl", () => {
  it("encodes the query and adds no company parameters when there are none", () => {
    expect(buildGreenhouseSearchUrl("react engineer", [])).toBe("/api/greenhouse?query=react%20engineer");
    expect(buildGreenhouseSearchUrl("a&b", undefined)).toBe("/api/greenhouse?query=a%26b");
  });

  it("sends known companies as one comma-joined slug list", () => {
    expect(buildGreenhouseSearchUrl("x", [{ slug: "stripe" }, { slug: "airbnb" }])).toBe(
      "/api/greenhouse?query=x&companies=stripe,airbnb",
    );
  });

  it("sends unknown companies as encoded companyName parameters, after the slugs", () => {
    expect(buildGreenhouseSearchUrl("x", ["Acme & Co", { slug: "stripe" }, "Initech"])).toBe(
      "/api/greenhouse?query=x&companies=stripe&companyName=Acme%20%26%20Co&companyName=Initech",
    );
  });
});
