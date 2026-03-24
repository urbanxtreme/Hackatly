package main

import "sort"

// ResolveDeadlock takes a set of tasks with detected deadlock cycles
// and returns a reordered, conflict-free execution plan.
// Strategy:
//   1. Reorder tasks by priority (higher first), then by created_at (earlier first)
//   2. Tasks involved in cycles with lower priority get paused (status = "waiting")
//   3. Returns the reordered list with statuses updated

type DeadlockResolution struct {
	ReorderedTasks []Task    `json:"reordered_tasks"`
	PausedTaskIDs  []string  `json:"paused_task_ids"`
	Message        string    `json:"message"`
}

func ResolveDeadlock(tasks []Task, cycles [][]string) DeadlockResolution {
	if len(cycles) == 0 {
		return DeadlockResolution{
			ReorderedTasks: tasks,
			PausedTaskIDs:  nil,
			Message:        "no deadlock detected",
		}
	}

	// Collect all task IDs involved in cycles
	cycleSet := make(map[string]bool)
	for _, cycle := range cycles {
		for _, tid := range cycle {
			cycleSet[tid] = true
		}
	}

	// Sort all tasks by priority then created_at
	sorted := make([]Task, len(tasks))
	copy(sorted, tasks)
	sort.Slice(sorted, func(i, j int) bool {
		pi, pj := priorityValue(sorted[i].Priority), priorityValue(sorted[j].Priority)
		if pi != pj {
			return pi > pj
		}
		return sorted[i].CreatedAt.Before(sorted[j].CreatedAt)
	})

	// For each cycle, the lowest-priority task gets paused
	var paused []string
	var active []Task

	reserved := make(map[[2]int]string)

	for _, task := range sorted {
		getPos := [2]int{task.GetX, task.GetY}
		putPos := [2]int{task.PutX, task.PutY}

		conflict := false
		if _, exists := reserved[getPos]; exists {
			conflict = true
		}
		if _, exists := reserved[putPos]; exists {
			conflict = true
		}

		if conflict && cycleSet[task.TaskID] {
			task.Status = "waiting"
			paused = append(paused, task.TaskID)
		} else {
			task.Status = "pending"
			reserved[getPos] = task.TaskID
			reserved[putPos] = task.TaskID
			active = append(active, task)
		}
	}

	for _, task := range sorted {
		for _, pid := range paused {
			if task.TaskID == pid {
				active = append(active, task)
				break
			}
		}
	}

	return DeadlockResolution{
		ReorderedTasks: active,
		PausedTaskIDs:  paused,
		Message:        "deadlock resolved",
	}
}
