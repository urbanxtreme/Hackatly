package main

// Deadlock detection using wait-for graph with DFS cycle detection.
// Each task is a node. An edge A -> B exists if Task A needs a position
// currently occupied/targeted by Task B.

type WaitForGraph struct {
	Edges map[string][]string // task_id -> list of task_ids it waits for
}

func NewWaitForGraph() *WaitForGraph {
	return &WaitForGraph{
		Edges: make(map[string][]string),
	}
}

func (g *WaitForGraph) AddEdge(from, to string) {
	g.Edges[from] = append(g.Edges[from], to)
}

// DetectCycles uses DFS to find all cycles in the wait-for graph
func (g *WaitForGraph) DetectCycles() [][]string {
	visited := make(map[string]bool)
	inStack := make(map[string]bool)
	var cycles [][]string
	path := []string{}

	var dfs func(node string) bool
	dfs = func(node string) bool {
		visited[node] = true
		inStack[node] = true
		path = append(path, node)

		for _, neighbor := range g.Edges[node] {
			if !visited[neighbor] {
				if dfs(neighbor) {
					return true
				}
			} else if inStack[neighbor] {
				// Found a cycle — extract it
				cycleStart := -1
				for i, n := range path {
					if n == neighbor {
						cycleStart = i
						break
					}
				}
				if cycleStart >= 0 {
					cycle := make([]string, len(path[cycleStart:]))
					copy(cycle, path[cycleStart:])
					cycles = append(cycles, cycle)
				}
				return true
			}
		}

		path = path[:len(path)-1]
		inStack[node] = false
		return false
	}

	for node := range g.Edges {
		if !visited[node] {
			dfs(node)
		}
	}

	return cycles
}

// BuildWaitForGraph creates a wait-for graph from a set of tasks.
// A conflict exists when one task's get/put coordinates match another task's get/put coordinates.
func BuildWaitForGraph(tasks []Task) *WaitForGraph {
	graph := NewWaitForGraph()

	for i := 0; i < len(tasks); i++ {
		for j := 0; j < len(tasks); j++ {
			if i == j {
				continue
			}
			// Task i waits for Task j if:
			// - i's get position == j's get position (both want same pickup)
			// - i's get position == j's put position (i wants where j drops)
			// - i's put position == j's get position (i drops where j picks)
			// - i's put position == j's put position (both want same drop)
			if positionsConflict(tasks[i], tasks[j]) {
				graph.AddEdge(tasks[i].TaskID, tasks[j].TaskID)
			}
		}
	}

	return graph
}

func positionsConflict(a, b Task) bool {
	// a's get conflicts with b's get or put
	if (a.GetX == b.GetX && a.GetY == b.GetY) ||
		(a.GetX == b.PutX && a.GetY == b.PutY) {
		return true
	}
	// a's put conflicts with b's get or put
	if (a.PutX == b.GetX && a.PutY == b.GetY) ||
		(a.PutX == b.PutX && a.PutY == b.PutY) {
		return true
	}
	return false
}

// CheckDeadlock is the main entry point — returns detected cycles
func CheckDeadlock(tasks []Task) [][]string {
	graph := BuildWaitForGraph(tasks)
	return graph.DetectCycles()
}
