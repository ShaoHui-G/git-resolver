package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/spf13/viper"
)

func main() {
	// ---------- Viper 配置初始化 ----------
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")

	// 读取配置文件 不存在就报错
	if err := viper.ReadInConfig(); err != nil {
		panic(err)
	}

	// 自动匹配
	viper.AutomaticEnv()

	// ---------- 启动核心逻辑 ----------
	runResolver()
}

// runResolver 执行发版流程（从上一轮脚本迁移而来）
func runResolver() {
	// 从 Viper 读取所有配置
	repoPath := viper.GetString("git_path")
	version := viper.GetString("git_version")
	sourceBranch := viper.GetString("git_source")
	workBranch := viper.GetString("git_work")
	targetBranch := viper.GetString("git_target")

	// 版本号校验：如果配置里没写，且环境变量也没传，则报错退出
	if version == "" {
		fmt.Println("❌ 错误：未指定版本号。请在 config.yaml 中设置 git_version，")
		os.Exit(1)
	}

	fmt.Printf("🚀 开始执行发版流程，版本: %s\n", version)
	fmt.Printf("   仓库路径: %s\n", repoPath)
	fmt.Printf("   源分支: %s → 工作台: %s → 目标: %s\n\n", sourceBranch, workBranch, targetBranch)

	// 调用Git 操作逻辑
	err := DoRelease(repoPath, sourceBranch, workBranch, targetBranch, version)
	if err != nil {
		fmt.Printf("❌ 发版失败: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("✅ 版本 %s 发版成功！\n", version)
}

func git(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	return out.String(), err
}

func isClean(dir string) bool {
	out, _ := git(dir, "status", "--porcelain")
	return strings.TrimSpace(out) == ""
}

func hasConflicts(dir string) bool {
	out, _ := git(dir, "status", "--porcelain")
	return strings.Contains(out, "UU") || strings.Contains(out, "AA")
}

// DoRelease 执行完整的发版流程
func DoRelease(repo, source, work, target, version string) error {
	// 预检工作区
	if !isClean(repo) {
		return fmt.Errorf("工作区有未提交的改动，请先提交或暂存")
	}

	// 更新源分支（若有远程协作）
	fmt.Printf("📦 更新 %s 分支...\n", source)
	if _, err := git(repo, "checkout", source); err != nil {
		return err
	}

	// 拉取远程代码
	if _, err := git(repo, "pull", "origin", source); err != nil {
		return fmt.Errorf("⚠️  拉取远程 %s 失败: %v\n", source, err)
	}

	// 切到工作台分支，Squash 合并 source
	fmt.Printf("🔀 将 %s Squash 合并到 %s...\n", source, work)
	if _, err := git(repo, "checkout", work); err != nil {
		return err
	}
	if _, err := git(repo, "merge", "--squash", source); err != nil {
		// --squash 在无变更时不报错，但提交时会报错，这里忽略
	}
	// 提交 Squash 变更（单次提交）
	msg := fmt.Sprintf("Release candidate %s", version)
	if _, err := git(repo, "commit", "-m", msg); err != nil {
		// 如果没有变更，commit 会失败，此时判断是否真的无变更
		status, _ := git(repo, "status", "--porcelain")
		if strings.TrimSpace(status) == "" {
			return fmt.Errorf("ℹ️  没有新的变更需要提交，发版流程终止。")
		}
		return fmt.Errorf("提交 Squash 失败: %v", err)
	}
	fmt.Print(target)
	//// 3. 获取刚刚生成的 commit hash
	//hashOut, err := git(repo, "rev-parse", "HEAD")
	//if err != nil {
	//	return err
	//}
	//hash := strings.TrimSpace(hashOut)
	//fmt.Printf("✅ 生成单次提交: %s\n", hash[:8])
	//
	//// 4. 切换到目标分支，Cherry-pick 该提交
	//fmt.Printf("⏫ 将单次提交 Cherry-pick 到 %s...\n", target)
	//if _, err := git(repo, "checkout", target); err != nil {
	//	return err
	//}
	//if _, err := git(repo, "cherry-pick", hash); err != nil {
	//	if hasConflicts(repo) {
	//		fmt.Println("❌ Cherry-pick 发生冲突！请手动解决冲突，然后执行 'git cherry-pick --continue'。")
	//		fmt.Println("解决完成后，按 Enter 键继续...")
	//		fmt.Scanln()
	//		if hasConflicts(repo) {
	//			return fmt.Errorf("冲突仍未解决，请手动处理")
	//		}
	//	} else {
	//		return fmt.Errorf("Cherry-pick 失败: %v", err)
	//	}
	//}
	//
	//// 5. 推送目标分支（若配置开启）
	//if push {
	//	fmt.Printf("⬆️ 推送 %s 到 %s...\n", target, remote)
	//	if _, err := git(repo, "push", remote, target); err != nil {
	//		return fmt.Errorf("推送失败: %v", err)
	//	}
	//}
	//
	//// 6. 删除旧的工作台分支（切到源分支再删）
	//fmt.Printf("🗑️  删除旧的 %s 分支...\n", work)
	//if _, err := git(repo, "checkout", source); err != nil {
	//	return err
	//}
	//if _, err := git(repo, "branch", "-D", work); err != nil {
	//	// 若分支不存在，忽略
	//}
	//
	//// 7. 从源分支重建新的工作台分支
	//fmt.Printf("🔄 从 %s 重建 %s...\n", source, work)
	//if _, err := git(repo, "checkout", "-b", work, source); err != nil {
	//	return err
	//}
	//
	//// 8. 可选推送工作台和源分支
	//if push {
	//	git(repo, "push", remote, source)
	//	git(repo, "push", remote, work) // 若需要可推送
	//}

	return nil
}
