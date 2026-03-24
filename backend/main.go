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

	InitTaskQueue()
	StartTaskWorker()

	r.POST("/register", RegisterHandler)
	r.POST("/login", LoginHandler)

	protected := r.Group("/")
	protected.Use(AuthMiddleware())
	{
		protected.POST("/robots", AddRobotHandler)
		protected.GET("/robots", GetAllRobotsHandler)
		protected.GET("/robots/:id", GetRobotByIDHandler)
		protected.PATCH("/robots/:id/state", UpdateRobotStateHandler)
		protected.PATCH("/robots/:id/priority", UpdateRobotPriorityHandler)

		protected.GET("/logs", GetLogsHandler)
		protected.POST("/logs", AddLogHandler)

		protected.POST("/init", InitMapHandler)
		protected.GET("/map", GetMapHandler)

		protected.POST("/task", CreateTaskHandler)
		protected.GET("/tasks", GetTasksHandler)


	}
	port := fmt.Sprintf(":%v", os.Getenv("port"))
	fmt.Printf("Server starting on http://localhost%s",port)
	if err := r.Run(port); err != nil {
		log.Fatalf("Failed to run server: %v\n", err)
	}
}