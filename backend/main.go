package main

import (
	"fmt"
	"log"
	"os"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {

	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, relying on system environment variables")
	}

	_, err := ConnectDatabase()
	if err != nil {
		log.Fatalf("Failed to connect to database: %v\n", err)
	}
	defer DisconnectDatabase()

	if err := CreateDatabase(); err != nil {
		log.Fatalf("Failed to create database: %v\n", err)
	}

	r := gin.Default()

r.Use(func(c *gin.Context) {
	origin := c.Request.Header.Get("Origin")

	if origin != "" {
		c.Header("Access-Control-Allow-Origin", origin)
		c.Header("Vary", "Origin")
	}

	c.Header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
	c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization")
	c.Header("Access-Control-Allow-Credentials", "true")

	if c.Request.Method == "OPTIONS" {
		c.AbortWithStatus(204)
		return
	}

	c.Next()
})

	InitTaskQueue()
	StartTaskWorker()

	r.POST("/register", RegisterHandler)
	r.POST("/login", LoginHandler)
	r.GET("/robots", GetAllRobotsHandler)
	protected := r.Group("/")
	protected.Use(AuthMiddleware())
	{
		protected.POST("/robots", AddRobotHandler)
		protected.GET("/robots/:id", GetRobotByIDHandler)
		protected.PATCH("/robots/:id/state", UpdateRobotStateHandler)
		protected.PATCH("/robots/:id/priority", UpdateRobotPriorityHandler)
		protected.PATCH("/robots/:id/position", UpdateRobotPositionHandler)
		protected.PATCH("/robots/:id/task", UpdateRobotTaskHandler)
		protected.POST("/robots/:id/efficiency", AddEfficiencyHandler)
		protected.GET("/robots/:id/efficiency", GetEfficiencyHandler)


		protected.GET("/logs", GetLogsHandler)
		protected.POST("/logs", AddLogHandler)

		protected.POST("/init", InitMapHandler)
		protected.GET("/map", GetMapHandler)
		protected.PUT("/map", UpdateMapHandler)

		protected.POST("/task", CreateTaskHandler)
		protected.GET("/tasks", GetTasksHandler)
		protected.DELETE("/tasks/:id", DeleteTaskHandler)
		protected.DELETE("/robots/:id", DeleteRobotHandler)
		protected.PATCH("/tasks/:id/complete", CompleteTaskHandler)



	}
	port := fmt.Sprintf(":%v", os.Getenv("port"))
	fmt.Printf("Server starting on http://localhost%s",port)
	if err := r.Run(port); err != nil {
		log.Fatalf("Failed to run server: %v\n", err)
	}
}