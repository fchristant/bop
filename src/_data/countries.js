const birds = require("./birds.json");

const names = [...new Set(birds.flatMap((bird) => bird.countries))].sort();

module.exports = names.map((name) => ({
  name,
  count: birds.filter((bird) => bird.countries.includes(name)).length,
}));
