package main

import (
	"container/heap"
	"sync"
	"time"
)

type Task struct {
	TaskID         string    `json:"task_id"`
	GetX           int       `json:"get_x"`
	GetY           int       `json:"get_y"`
	PutX           int       `json:"put_x"`
	PutY           int       `json:"put_y"`
	Priority       string    `json:"priority"`
	Status         string    `json:"status"`
	BotID          int64     `json:"bot_id"`
	CreatedAt      time.Time `json:"created_at"`
}

func priorityValue(p string) int {
	switch p {
	case "high":
		return 3
	case "medium":
		return 2
	case "low":
		return 1
	default:
		return 0
	}
}

type TaskHeap []Task

func (h TaskHeap) Len() int { return len(h) }
func (h TaskHeap) Less(i, j int) bool {
	pi, pj := priorityValue(h[i].Priority), priorityValue(h[j].Priority)
	if pi != pj {
		return pi > pj // higher priority first
	}
	return h[i].CreatedAt.Before(h[j].CreatedAt) // earlier task first
}
func (h TaskHeap) Swap(i, j int) { h[i], h[j] = h[j], h[i] }

func (h *TaskHeap) Push(x interface{}) {
	*h = append(*h, x.(Task))
}

func (h *TaskHeap) Pop() interface{} {
	old := *h
	n := len(old)
	item := old[n-1]
	*h = old[:n-1]
	return item
}

type PriorityQueue struct {
	mu     sync.Mutex
	heap   TaskHeap
	notify chan struct{}
}

var TaskQueue PriorityQueue

func InitTaskQueue() {
	TaskQueue.mu.Lock()
	defer TaskQueue.mu.Unlock()
	TaskQueue.heap = TaskHeap{}
	heap.Init(&TaskQueue.heap)
	TaskQueue.notify = make(chan struct{}, 1)
}


func NotifyNewTask() {
	select {
	case TaskQueue.notify <- struct{}{}:
	default:
	}
}

func PushTask(task Task) {
	TaskQueue.mu.Lock()
	heap.Push(&TaskQueue.heap, task)
	TaskQueue.mu.Unlock()
	NotifyNewTask()
}

func PopTask() (Task, bool) {
	TaskQueue.mu.Lock()
	defer TaskQueue.mu.Unlock()
	if TaskQueue.heap.Len() == 0 {
		return Task{}, false
	}
	return heap.Pop(&TaskQueue.heap).(Task), true
}

func PeekTasks() []Task {
	TaskQueue.mu.Lock()
	defer TaskQueue.mu.Unlock()
	result := make([]Task, len(TaskQueue.heap))
	copy(result, TaskQueue.heap)
	return result
}

func DrainTasks() []Task {
	TaskQueue.mu.Lock()
	defer TaskQueue.mu.Unlock()
	var tasks []Task
	for TaskQueue.heap.Len() > 0 {
		tasks = append(tasks, heap.Pop(&TaskQueue.heap).(Task))
	}
	return tasks
}

func RemoveTaskByID(id string) {
	TaskQueue.mu.Lock()
	defer TaskQueue.mu.Unlock()
	for i, t := range TaskQueue.heap {
		if t.TaskID == id {
			heap.Remove(&TaskQueue.heap, i)
			return
		}
	}
}
