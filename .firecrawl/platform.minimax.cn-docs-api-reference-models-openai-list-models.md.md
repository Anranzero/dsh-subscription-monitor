> ## Documentation Index
> Fetch the complete documentation index at: https://platform.minimaxi.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# 获取模型列表

> 获取平台支持的所有模型列表，兼容 OpenAI API 规范



## OpenAPI

````yaml api-reference/models/openai/api/list-models.json GET /v1/models
openapi: 3.1.0
info:
  title: MiniMax Models API
  description: MiniMax models API compatible with OpenAI API specification.
  version: 1.0.0
servers:
  - url: https://api.minimax.cn
security:
  - bearerAuth: []
paths:
  /v1/models:
    get:
      tags:
        - Models
      summary: 获取模型列表
      description: 获取平台支持的所有模型列表。该接口兼容 OpenAI API 规范。
      operationId: listModels
      responses:
        '200':
          description: 可用模型列表。
          content:
            application/json:
              schema:
                type: object
                properties:
                  object:
                    type: string
                    description: 对象类型，固定为 `"list"`
                  data:
                    type: array
                    description: 模型对象数组
                    items:
                      type: object
                      properties:
                        id:
                          type: string
                          description: 模型标识符
                        object:
                          type: string
                          description: 对象类型，固定为 `"model"`
                        created:
                          type: integer
                          description: 模型创建时间（Unix 时间戳）
                        owned_by:
                          type: string
                          description: 模型所属组织
              examples:
                默认响应:
                  value:
                    object: list
                    data:
                      - id: MiniMax-M3
                        object: model
                        created: 1780272000
                        owned_by: minimax
                      - id: MiniMax-M2.7
                        object: model
                        created: 1773799200
                        owned_by: minimax
                      - id: MiniMax-M2.5
                        object: model
                        created: 1770948000
                        owned_by: minimax
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: |-
        `HTTP: Bearer Auth`
         - Security Scheme Type: http
         - HTTP Authorization Scheme: Bearer API_key，用于验证账户信息，可在 [账户管理>接口密钥](https://platform.minimax.cn/user-center/basic-information/interface-key) 中查看

````