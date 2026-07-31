const birds = require("./birds.json");

const names = [...new Set(birds.map((bird) => bird.genus))].sort();

module.exports = names.map((name) => ({
  name,
  count: birds.filter((bird) => bird.genus === name).length,
}));
