export const GRID_SIZE = 30;

export const getStaticGrid = () => {
  const g = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));
  for (let x = 3; x < GRID_SIZE - 3; x += 5) {
    for (let z = 3; z < GRID_SIZE - 3; z++) {
      if (z % 8 !== 0 && z % 8 !== 1) {
        g[x][z] = 1;
        g[x + 1][z] = 1;
      }
    }
  }
  // Add 1-tile wide "tunnel" on Z=28 between X=5 and X=25
  for (let x = 5; x <= 25; x++) {
    g[x][27] = 1; // Top wall
    g[x][29] = 1; // Bottom wall
  }
  
  return g;
};

export const STATIC_GRID = getStaticGrid();
