module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });

  return {
    pathPrefix: "/bop/",
    dir: {
      input: "src",
      output: "_site",
    },
  };
};
