import type { Skill, SkillSummary } from '@tengyu-aipod/shared'
import { useEffect, useMemo, useState } from 'react'
import {
  defaultPromptSkillId,
  isExtractSkillSummary,
  promptSkillStorageKey,
  skillOptionKey,
} from '../lib/format'

export function useExtractSkillOptions(setError: (error: string | null) => void) {
  const [extractSkills, setExtractSkills] = useState<SkillSummary[]>([])
  const [selectedSkillKey, setSelectedSkillKey] = useState('')
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)
  const selectedSkillSummary = useMemo(
    () => extractSkills.find((skill) => skillOptionKey(skill) === selectedSkillKey) ?? null,
    [extractSkills, selectedSkillKey],
  )

  useEffect(() => {
    let mounted = true
    window.api.skill
      .list({ module: 'generation' })
      .then((skills) => {
        if (!mounted) {
          return
        }
        const nextSkills = skills.filter(isExtractSkillSummary)
        setExtractSkills(nextSkills)
        setSelectedSkillKey((current) =>
          current && nextSkills.some((skill) => skillOptionKey(skill) === current)
            ? current
            : nextSkills[0]
              ? skillOptionKey(nextSkills[0])
              : '',
        )
      })
      .catch((nextError) => {
        if (!mounted) {
          return
        }
        setExtractSkills([])
        setSelectedSkillKey('')
        setSelectedSkill(null)
        setError(
          nextError instanceof Error ? nextError.message : '读取提取 Skill 失败，请先在后台配置',
        )
      })

    return () => {
      mounted = false
    }
  }, [setError])

  useEffect(() => {
    let mounted = true
    const skillSummary = selectedSkillSummary
    if (!skillSummary) {
      setSelectedSkill(null)
      return () => {
        mounted = false
      }
    }

    window.api.skill
      .get({ id: skillSummary.id, version: skillSummary.version })
      .then((skill) => {
        if (!mounted) {
          return
        }
        setSelectedSkill(skill)
      })
      .catch((nextError) => {
        if (!mounted) {
          return
        }
        setSelectedSkill(null)
        setError(
          nextError instanceof Error ? nextError.message : '读取提取 Skill 失败，请先在后台配置',
        )
      })

    return () => {
      mounted = false
    }
  }, [selectedSkillSummary, setError])

  return { extractSkills, selectedSkill, selectedSkillKey, setSelectedSkillKey }
}

export function usePromptSkillOptions(category: string, setError: (error: string | null) => void) {
  const [promptSkills, setPromptSkills] = useState<SkillSummary[]>([])
  const [selectedSkillId, setSelectedSkillId] = useState('')
  const selectedSkill = useMemo(
    () => promptSkills.find((skill) => skill.id === selectedSkillId) ?? null,
    [promptSkills, selectedSkillId],
  )

  useEffect(() => {
    let mounted = true
    window.api.skill
      .list({ module: 'generation', category })
      .then((skills) => {
        if (!mounted) {
          return
        }
        setPromptSkills(skills)
        setSelectedSkillId((current) => {
          if (current && skills.some((skill) => skill.id === current)) {
            return current
          }

          const remembered = window.localStorage.getItem(promptSkillStorageKey(category))
          if (remembered && skills.some((skill) => skill.id === remembered)) {
            return remembered
          }

          const fallbackId = defaultPromptSkillId(category)
          if (skills.some((skill) => skill.id === fallbackId)) {
            return fallbackId
          }

          return skills[0]?.id ?? ''
        })
      })
      .catch((nextError) => {
        if (!mounted) {
          return
        }
        setPromptSkills([])
        setSelectedSkillId('')
        setError(nextError instanceof Error ? nextError.message : '读取提示词 Skill 失败')
      })

    return () => {
      mounted = false
    }
  }, [category, setError])

  function selectPromptSkill(skillId: string) {
    setSelectedSkillId(skillId)
    if (skillId) {
      window.localStorage.setItem(promptSkillStorageKey(category), skillId)
    } else {
      window.localStorage.removeItem(promptSkillStorageKey(category))
    }
  }

  return { promptSkills, selectedSkill, selectedSkillId, selectPromptSkill }
}
