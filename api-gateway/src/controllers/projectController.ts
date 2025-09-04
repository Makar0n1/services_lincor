import { Request, Response } from 'express';
import Joi from 'joi';
import { ProjectModel, CreateProjectData, UpdateProjectData } from '../models/Project';

// Схемы валидации
const createProjectSchema = Joi.object({
  name: Joi.string().min(1).max(255).required().messages({
    'string.min': 'Project name cannot be empty',
    'string.max': 'Project name is too long (max 255 characters)',
    'any.required': 'Project name is required'
  })
});

const updateProjectSchema = Joi.object({
  name: Joi.string().min(1).max(255).required().messages({
    'string.min': 'Project name cannot be empty',
    'string.max': 'Project name is too long (max 255 characters)',
    'any.required': 'Project name is required'
  })
});

export class ProjectController {
  // Вспомогательная функция для проверки ID
  private static validateId(id: string | undefined, res: Response, name: string = 'ID'): id is string {
    if (!id) {
      res.status(400).json({
        success: false,
        message: `${name} is required`
      });
      return false;
    }
    
    // Проверка формата UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      res.status(400).json({
        success: false,
        message: `Invalid ${name} format. Expected UUID.`
      });
      return false;
    }
    
    return true;
  }

  // Создание нового проекта
  static async createProject(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      // Валидация входных данных
      const { error, value } = createProjectSchema.validate(req.body);
      if (error) {
        res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.details.map(detail => detail.message)
        });
        return;
      }

      const { name } = value;

      // Проверка лимитов проекта
      const limits = await ProjectModel.checkProjectLimits(req.user.userId);
      if (!limits.canCreate) {
        res.status(403).json({
          success: false,
          message: `Project limit reached. Your plan allows ${limits.limit} projects.`
        });
        return;
      }

      // Создание проекта
      const projectData: CreateProjectData = {
        user_id: req.user.userId,
        name
      };

      const project = await ProjectModel.create(projectData);

      res.status(201).json({
        success: true,
        message: 'Project created successfully',
        data: {
          project: {
            id: project.id,
            name: project.name,
            createdAt: project.created_at
          }
        }
      });

    } catch (error) {
      console.error('Create project error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create project'
      });
    }
  }

  // Получение всех проектов пользователя
  static async getProjects(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const page = parseInt(req.query['page'] as string) || 1;
      const limit = parseInt(req.query['limit'] as string) || 10;
      const search = req.query['search'] as string;

      let projects;
      let total = 0;
      let pages = 0;

      if (search) {
        // Поиск проектов
        const searchResults = await ProjectModel.searchByUserId(req.user.userId, search);
        projects = searchResults.map(project => ({
          ...project,
          stats: {
            totalLinks: 0,
            uniqueDomains: 0,
            activeSheets: 0,
            lastCheck: null
          }
        }));
        total = projects.length;
        pages = 1;
      } else {
        // Получение проектов с пагинацией
        const result = await ProjectModel.findByUserIdPaginated(req.user.userId, page, limit);
        projects = result.projects;
        total = result.total;
        pages = result.pages;
      }

      res.status(200).json({
        success: true,
        data: {
          projects,
          pagination: {
            page,
            limit,
            total,
            pages
          }
        }
      });

    } catch (error) {
      console.error('Get projects error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get projects'
      });
    }
  }

  // Получение конкретного проекта
  static async getProject(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const { id } = req.params;
      if (!ProjectController.validateId(id, res, 'Project ID')) return;

      // Получение проекта с проверкой владельца
      const project = await ProjectModel.findByIdAndOwner(id, req.user.userId);
      if (!project) {
        res.status(404).json({
          success: false,
          message: 'Project not found'
        });
        return;
      }

      // Получение статистики проекта
      const stats = await ProjectModel.getProjectStats(id);

      res.status(200).json({
        success: true,
        data: {
          project: {
            id: project.id,
            name: project.name,
            createdAt: project.created_at,
            updatedAt: project.updated_at
          },
          stats
        }
      });

    } catch (error) {
      console.error('Get project error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get project'
      });
    }
  }

  // Обновление проекта
  static async updateProject(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const { id } = req.params;
      if (!ProjectController.validateId(id, res, 'Project ID')) return;

      // Валидация входных данных
      const { error, value } = updateProjectSchema.validate(req.body);
      if (error) {
        res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: error.details.map(detail => detail.message)
        });
        return;
      }

      // Проверка существования проекта и владельца
      const existingProject = await ProjectModel.findByIdAndOwner(id, req.user.userId);
      if (!existingProject) {
        res.status(404).json({
          success: false,
          message: 'Project not found'
        });
        return;
      }

      // Обновление проекта
      const updateData: UpdateProjectData = {
        name: value.name
      };

      const project = await ProjectModel.update(id, updateData);

      res.status(200).json({
        success: true,
        message: 'Project updated successfully',
        data: {
          project: {
            id: project!.id,
            name: project!.name,
            updatedAt: project!.updated_at
          }
        }
      });

    } catch (error) {
      console.error('Update project error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update project'
      });
    }
  }

  // Удаление проекта
  static async deleteProject(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
        return;
      }

      const { id } = req.params;
      if (!ProjectController.validateId(id, res, 'Project ID')) return;

      // Проверка существования проекта и владельца
      const project = await ProjectModel.findByIdAndOwner(id, req.user.userId);
      if (!project) {
        res.status(404).json({
          success: false,
          message: 'Project not found'
        });
        return;
      }

      // Удаление проекта (каскадное удаление ссылок и таблиц)
      await ProjectModel.delete(id);

      res.status(200).json({
        success: true,
        message: 'Project deleted successfully'
      });

    } catch (error) {
      console.error('Delete project error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete project'
      });
    }
  }
}