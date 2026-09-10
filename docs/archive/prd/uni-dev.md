# 前后端开发工具集成

开发者可以通过本工具达到前后端统一开发
命令行工具 @packages/cli/
oj 开发工具, 拷贝 /Users/ever/git/rust/only-js/dist/oj-v0.1.0.tar.gz 到 项目 bin 目录解压

## 创建工程

ram init <project_name> 来初始化项目 <project_name>
构建如下基本目录结构

```text
 ├── bin         # 开发工具，安装 oj 产物
 ├── api
 │   ├── dist    # 后端api接口编译后的产物
 │   └── src     # 后端 api 接口开发源码
 ├── modules     # 前端模块源码目录
 │   ├── dist    # 前端模块编译后的产物
 │   └── src     # 前端模块开发源码
 │        └── demo    # 前端模块 demo
```

## 开发模式

ram dev 将开始开发模式
开发人员修改 api/src/ 下的文件，将借助于 oj 工具，获得实时接口变化功能
修改 modules/src/ 下的文件，将获得实时模块开发体验，这里借助 devServer 与 oj 相结合，请给出方案

## 构建

ram build 当分别将 src 中的源码构建到同级 dist 目录下，借助与vite工具

## 预览

raw preview 将借助oj工具，启动服务 --app-path 指向 modules/dist 构建产物，--api-path 指向 api/dist 构建产物，实现前后端的一体化预览。
