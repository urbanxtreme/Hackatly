package main

import (
	"container/heap"
	"fmt"
	"math"
	"sync"
)

type PathStep struct {
	X int `json:"x"`
	Y int `json:"y"`
	T int `json:"t"`
}

type ReservationTable struct {
	mu       sync.RWMutex
	reserved map[string]bool
}

var Reservations ReservationTable

func InitReservations() {
	Reservations = ReservationTable{
		reserved: make(map[string]bool),
	}
}

func reservationKey(x, y, t int) string {
	return fmt.Sprintf("%d,%d,%d", x, y, t)
}

func (rt *ReservationTable) Reserve(x, y, t int) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	rt.reserved[reservationKey(x, y, t)] = true
}

func (rt *ReservationTable) IsReserved(x, y, t int) bool {
	rt.mu.RLock()
	defer rt.mu.RUnlock()
	return rt.reserved[reservationKey(x, y, t)]
}

func (rt *ReservationTable) ReservePath(path []PathStep) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	for _, step := range path {
		rt.reserved[reservationKey(step.X, step.Y, step.T)] = true
	}
}


type astarNode struct {
	x, y, t  int
	g, h, f  float64
	parent   *astarNode
}

type astarHeap []*astarNode

func (h astarHeap) Len() int            { return len(h) }
func (h astarHeap) Less(i, j int) bool   { return h[i].f < h[j].f }
func (h astarHeap) Swap(i, j int)        { h[i], h[j] = h[j], h[i] }
func (h *astarHeap) Push(x interface{})  { *h = append(*h, x.(*astarNode)) }
func (h *astarHeap) Pop() interface{} {
	old := *h
	n := len(old)
	item := old[n-1]
	*h = old[:n-1]
	return item
}

func heuristic(x1, y1, x2, y2 int) float64 {
	return math.Abs(float64(x1-x2)) + math.Abs(float64(y1-y2))
}

func CooperativeAStar(startX, startY, goalX, goalY int) ([]PathStep, error) {
	grid := GetMap()
	if grid == nil {
		return nil, fmt.Errorf("map not initialized")
	}
	rows := len(grid)
	if rows == 0 {
		return nil, fmt.Errorf("map is empty")
	}
	cols := len(grid[0])

	maxTime := rows * cols * 4 // upper bound on time steps

	// directions: up, down, left, right, wait
	dx := []int{-1, 1, 0, 0, 0}
	dy := []int{0, 0, -1, 1, 0}

	open := &astarHeap{}
	heap.Init(open)

	startNode := &astarNode{
		x: startX, y: startY, t: 0,
		g: 0, h: heuristic(startX, startY, goalX, goalY),
	}
	startNode.f = startNode.g + startNode.h
	heap.Push(open, startNode)

	closed := make(map[string]bool)

	for open.Len() > 0 {
		current := heap.Pop(open).(*astarNode)

		if current.x == goalX && current.y == goalY {
			var path []PathStep
			node := current
			for node != nil {
				path = append([]PathStep{{X: node.x, Y: node.y, T: node.t}}, path...)
				node = node.parent
			}
			return path, nil
		}

		key := reservationKey(current.x, current.y, current.t)
		if closed[key] {
			continue
		}
		closed[key] = true

		if current.t >= maxTime {
			continue
		}

		for i := 0; i < 5; i++ {
			nx, ny, nt := current.x+dx[i], current.y+dy[i], current.t+1

			if nx < 0 || ny < 0 || nx >= rows || ny >= cols {
				continue
			}
			if grid[nx][ny] == 1 {
				continue
			}
			if Reservations.IsReserved(nx, ny, nt) {
				continue
			}

			nKey := reservationKey(nx, ny, nt)
			if closed[nKey] {
				continue
			}

			g := current.g + 1
			h := heuristic(nx, ny, goalX, goalY)
			neighbor := &astarNode{
				x: nx, y: ny, t: nt,
				g: g, h: h, f: g + h,
				parent: current,
			}
			heap.Push(open, neighbor)
		}
	}

	return nil, fmt.Errorf("no path found from (%d,%d) to (%d,%d)", startX, startY, goalX, goalY)
}
