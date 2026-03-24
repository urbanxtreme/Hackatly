package main

import "sync"

type GridMap struct {
	mu     sync.RWMutex
	Matrix [][]int
	Rows   int
	Cols   int
}

var Map GridMap

func InitMap(matrix [][]int) {
	Map.mu.Lock()
	defer Map.mu.Unlock()
	Map.Matrix = matrix
	Map.Rows = len(matrix)
	if Map.Rows > 0 {
		Map.Cols = len(matrix[0])
	}
}

func GetMap() [][]int {
	Map.mu.RLock()
	defer Map.mu.RUnlock()
	return Map.Matrix
}

func IsWalkable(x, y int) bool {
	Map.mu.RLock()
	defer Map.mu.RUnlock()
	if x < 0 || y < 0 || x >= Map.Rows || y >= Map.Cols {
		return false
	}
	return Map.Matrix[x][y] == 0
}
