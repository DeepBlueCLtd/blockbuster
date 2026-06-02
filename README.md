# blockbuster
Travelling salesman route-finding through non-uniform space

# Objective

Playground environment to experiment with interactions and visualisations regarding choice of routes through an environment.  A hex grid will be placed over the environment, and  Travelling Salesman Problem (TSP) techniques will be applied to generating optimal routes (COAs: Courses of Action) through the environment, generating permutations of routes that that travel between two or more cells in the grid.

The cost function in each hex cell will be a compsite of a number of risks, to include:
- animals
- cold
- heat
- absence of water
- thief

## UI
The general layout will be a map control on the left, with tabs controls on the right hand side.  These tabs will be present:
- risk appetite
- COAs
 
The algorithm will generate 3 courses of action. These will be plotted as 3 vertically aligned stacked bar charts, with each bar representing the passage through a hex cell.

A ficticious underlying map will be generated, which includes woodland, towns, savannah, mountains. The map will be 50km wide by 30km tall.  The size of the hex cells will be tunable, but the default will apply a uniform grid of 100 cells.

## Interactions
Sliders will allow the user to control their risk appetite for each risk.

Each hex cell will contain a small table showing the level of each risk in that cell. The analyst will be able to override per-cell risks, with modified values shown in highlight (with ability to reset individual overrides).


