const fs = require("fs");
const path = require("path");

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy({ "src/images": "images" });
  eleventyConfig.addPassthroughCopy({ "src/audio": "audio" });
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });

  eleventyConfig.addFilter("limit", (arr, count) => arr.slice(0, count));

  eleventyConfig.addFilter("svgDimensions", (srcRelativePath) => {
    const filePath = path.join(__dirname, "src", srcRelativePath);
    const svg = fs.readFileSync(filePath, "utf8");
    const width = svg.match(/width="(\d+)"/);
    const height = svg.match(/height="(\d+)"/);
    return { width: width ? width[1] : null, height: height ? height[1] : null };
  });

  return {
    dir: {
      input: "src",
      output: "_site",
    },
  };
};
